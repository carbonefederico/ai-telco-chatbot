import * as z from 'zod/v4';
import { AuthError, requireScope } from '@telco-demo/shared/auth';
import { logEvent } from '@telco-demo/shared/logger';
import { mcpPaymentsScope, mcpProfileScope } from '@telco-demo/shared/scopes';
import { customers, payments, resolveCustomerId } from './mock-data.js';

function authFromExtra(extra) {
  const authInfo = extra.authInfo;
  if (!authInfo) {
    throw new AuthError('Missing MCP auth context', 401);
  }
  return {
    token: authInfo.token,
    scopes: authInfo.scopes ?? [],
    customerId: authInfo.extra?.customerId ?? 'cust-1001',
    subject: authInfo.extra?.subject ?? 'anonymous'
  };
}

function asToolText(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export function registerTelcoTools(server, cibaService) {
  server.registerTool(
    'get_customer_profile',
    {
      title: 'Customer profile',
      description: 'Read telco customer profile, service plan, devices, and usage.',
      inputSchema: {
        customerId: z.string().optional()
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async ({ customerId }, extra) => {
      const auth = authFromExtra(extra);
      logEvent('mcp-tool', 'called', {
        tool: 'get_customer_profile',
        subject: auth.subject,
        customerId: customerId ?? auth.customerId
      });
      requireScope(auth, mcpProfileScope);
      const resolvedCustomerId = resolveCustomerId(customerId, auth);
      const profile = customers[resolvedCustomerId];
      if (!profile) {
        return asToolText({ error: 'customer_not_found', customerId: resolvedCustomerId });
      }
      return asToolText(profile);
    }
  );

  server.registerTool(
    'get_payment_summary',
    {
      title: 'Payment summary',
      description: 'Read billing balance, due date, autopay, and recent invoice data.',
      inputSchema: {
        customerId: z.string().optional()
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async ({ customerId }, extra) => {
      const auth = authFromExtra(extra);
      logEvent('mcp-tool', 'called', {
        tool: 'get_payment_summary',
        subject: auth.subject,
        customerId: customerId ?? auth.customerId
      });
      requireScope(auth, mcpPaymentsScope);
      const resolvedCustomerId = resolveCustomerId(customerId, auth);
      if (!payments[resolvedCustomerId]) {
        return asToolText({ error: 'payments_not_found', customerId: resolvedCustomerId });
      }
      const approval = await cibaService.startPaymentApproval({
        auth,
        customerId: resolvedCustomerId
      });
      return asToolText(approval);
    }
  );
}
