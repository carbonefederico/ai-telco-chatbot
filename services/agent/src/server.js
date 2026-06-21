import express from 'express';
import cors from 'cors';
import { decodeJwt } from 'jose';
import { authMiddleware, staticDemoToken } from '@telco-demo/shared/auth';
import { loadOidcConfig, serviceConfig } from '@telco-demo/shared/config';
import { asyncHandler, errorHandler, getJson } from '@telco-demo/shared/http';
import { logEvent } from '@telco-demo/shared/logger';
import { fromAgentTask, toAgentResponse } from '@telco-demo/shared/protocol';
import { callMcpTools } from './mcp-client.js';
import { mockChatCompletion, telcoTools } from './mock-llm.js';

const service = serviceConfig();
const authConfig = await loadOidcConfig({ expectedAudience: service.agentExpectedAudience });
const app = express();

app.use(cors({ origin: service.allowedOrigins }));
app.use(express.json());
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    logEvent('agent-api', 'request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started
    });
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agent' });
});

app.post(
  '/a2a/message',
  authMiddleware({ config: authConfig }),
  asyncHandler(async (req, res) => {
    const task = fromAgentTask(req.body);
    const messages = [
      {
        role: 'system',
        content: 'You are a telco support assistant. Use tools for account, usage, billing, and payment data.'
      },
      { role: 'user', content: task.text }
    ];
    const planningResponse = await mockChatCompletion({
      model: 'mock-telco-support',
      messages,
      tools: telcoTools
    });
    const assistantMessage = planningResponse.choices[0].message;
    const requestedToolCalls = assistantMessage.tool_calls ?? [];
    const tools = requestedToolCalls.map((toolCall) => toolCall.function.name);

    logEvent('agent', 'request-received', {
      taskId: task.id,
      conversationId: task.conversationId,
      subject: req.auth.subject,
      mockLlmFinishReason: planningResponse.choices[0].finish_reason,
      tools,
      messageLength: task.text.length
    });
    const mcpToken = tools.length > 0 ? await exchangeTokenForMcp(req.auth.token || staticDemoToken) : staticDemoToken;
    const toolCalls = await callMcpTools(tools, mcpToken);
    const finalResponse = tools.length > 0
      ? await mockChatCompletion({
        model: 'mock-telco-support',
        messages: [
          ...messages,
          assistantMessage,
          ...toolCalls.map((result, index) => ({
            role: 'tool',
            tool_call_id: requestedToolCalls[index]?.id ?? `call_${index + 1}`,
            name: result.tool,
            content: JSON.stringify(result)
          }))
        ],
        tools: telcoTools
      })
      : planningResponse;
    const finalChoice = finalResponse.choices[0];

    logEvent('agent', 'response-created', {
      taskId: task.id,
      mockLlmFinishReason: finalChoice.finish_reason,
      toolCalls: toolCalls.map((result) => `${result.tool}:${result.error ? 'error' : 'ok'}`)
    });

    res.json(
      toAgentResponse({
        id: task.id,
        conversationId: task.conversationId,
        text: finalChoice.message.content,
        approval: finalResponse.metadata?.approval ?? null,
        toolCalls: toolCalls.map((result) => ({
          tool: result.tool,
          ok: !result.error,
          error: result.error?.message
        }))
      })
    );
  })
);

app.get(
  '/a2a/approvals/:approvalId',
  authMiddleware({ config: authConfig }),
  asyncHandler(async (req, res) => {
    const mcpToken = await exchangeTokenForMcp(req.auth.token || staticDemoToken);
    const approval = await getJson(`${service.mcpUrl.replace(/\/mcp$/, '')}/approvals/${req.params.approvalId}`, {
      token: mcpToken
    });
    logEvent('agent-mcp', 'approval-status', {
      approvalId: req.params.approvalId,
      status: approval.status
    });
    res.json(formatApprovalForClient(approval));
  })
);

app.use(errorHandler());

app.listen(service.agentPort, '127.0.0.1', () => {
  console.log(`Agent listening on http://127.0.0.1:${service.agentPort}`);
});

async function exchangeTokenForMcp(accessToken) {
  if (authConfig.noSecurity) {
    return accessToken || staticDemoToken;
  }

  if (!service.agentOauthClientId || !service.agentOauthClientSecret) {
    const error = new Error('AGENT_OAUTH_CLIENT_ID and AGENT_OAUTH_CLIENT_SECRET are required for MCP token exchange');
    error.status = 500;
    throw error;
  }
  if (!service.mcpTokenExchangeScope) {
    const error = new Error('MCP_TOKEN_EXCHANGE_SCOPE is required for MCP token exchange');
    error.status = 500;
    throw error;
  }

  const inboundTokenClaims = decodeTokenClaims(accessToken);
  const requestedScope = service.mcpTokenExchangeScope;

  logEvent('agent-mcp', 'mcp-token-exchange-start', {
    endpoint: authConfig.tokenEndpoint,
    scope: requestedScope,
    clientId: service.agentOauthClientId,
    inboundTokenClaims
  });

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: accessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: requestedScope
  });
  const headers = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`${service.agentOauthClientId}:${service.agentOauthClientSecret}`).toString('base64')}`
  };

  const response = await fetch(authConfig.tokenEndpoint, {
    method: 'POST',
    headers,
    body
  });
  const exchanged = await response.json().catch(() => ({}));
  if (!response.ok || !exchanged.access_token) {
    logEvent('agent-mcp', 'mcp-token-exchange-failed', {
      endpoint: authConfig.tokenEndpoint,
      status: response.status,
      error: exchanged.error,
      inboundTokenClaims
    });
    const error = new Error(
      exchanged.error_description ?? exchanged.error ?? `MCP token exchange failed with HTTP ${response.status}`
    );
    error.status = 502;
    throw error;
  }

  const outboundTokenClaims = decodeTokenClaims(exchanged.access_token);

  logEvent('agent-mcp', 'mcp-token-exchange-success', {
    endpoint: authConfig.tokenEndpoint,
    tokenType: exchanged.token_type,
    expiresIn: exchanged.expires_in,
    scope: exchanged.scope,
    inboundTokenClaims,
    outboundTokenClaims
  });

  return exchanged.access_token;
}

function decodeTokenClaims(token) {
  try {
    return decodeJwt(token);
  } catch (error) {
    return {
      decodeError: error.message
    };
  }
}

function formatApprovalForClient(approval) {
  if (approval.status === 'approved' && approval.paymentSummary) {
    const data = approval.paymentSummary;
    const invoices = Array.isArray(data.invoices) ? data.invoices.slice(0, 4) : [];
    const invoiceText = invoices.length > 0
      ? `\n\nRecent bills:\n${invoices.map((invoice) => {
        const period = invoice.period ?? invoice.id;
        const due = invoice.dueDate ? `, due ${invoice.dueDate}` : '';
        return `- ${period}: ${data.currency} ${invoice.amount.toFixed(2)} (${invoice.status}${due})`;
      }).join('\n')}`
      : '';
    return {
      status: 'approved',
      approvalId: approval.approvalId,
      message: `Approved. Your current balance is ${data.currency} ${data.balanceDue.toFixed(2)}, due on ${data.dueDate}. Autopay is ${data.autopay ? 'enabled' : 'disabled'}.${invoiceText}`,
      paymentSummary: data
    };
  }

  return approval;
}
