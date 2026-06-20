import { randomUUID } from 'node:crypto';
import { logEvent } from '@telco-demo/shared/logger';
import { mcpPaymentsScope } from '@telco-demo/shared/scopes';
import { payments } from './mock-data.js';

const cibaGrantType = 'urn:openid:params:grant-type:ciba';

export function createCibaService(serviceConfig, authConfig) {
  const approvals = new Map();

  async function startPaymentApproval({ auth, customerId }) {
    const approvalId = randomUUID();
    const now = Date.now();
    const isMock = authConfig.noSecurity || authConfig.authMode === 'dev';

    if (isMock) {
      const approval = {
        approvalId,
        mode: 'mock',
        status: 'pending',
        customerId,
        subject: auth.subject,
        createdAt: now,
        expiresAt: now + 5 * 60 * 1000,
        pollAfterSeconds: 2,
        mockReadyAt: now + serviceConfig.cibaMockApprovalSeconds * 1000
      };
      approvals.set(approvalId, approval);
      logEvent('mcp-ciba', 'mock-started', {
        approvalId,
        customerId,
        subject: auth.subject,
        pollAfterSeconds: approval.pollAfterSeconds
      });
      return pendingResponse(approval);
    }

    ensureCibaConfig(serviceConfig, authConfig);

    const body = new URLSearchParams({
      scope: serviceConfig.cibaScope || mcpPaymentsScope,
      login_hint: auth.subject,
      binding_message: 'PAYMENT',
      requested_expiry: '300'
    });
    const headers = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${serviceConfig.cibaClientId}:${serviceConfig.cibaClientSecret}`).toString('base64')}`
    };

    logEvent('mcp-ciba', 'backchannel-start', {
      endpoint: authConfig.backchannelAuthenticationEndpoint,
      approvalId,
      customerId,
      subject: auth.subject,
      scope: body.get('scope')
    });

    const response = await fetch(authConfig.backchannelAuthenticationEndpoint, {
      method: 'POST',
      headers,
      body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.auth_req_id) {
      logEvent('mcp-ciba', 'backchannel-failed', {
        endpoint: authConfig.backchannelAuthenticationEndpoint,
        status: response.status,
        error: data.error
      });
      throw new Error(data.error_description ?? data.error ?? `CIBA backchannel request failed with HTTP ${response.status}`);
    }

    const approval = {
      approvalId,
      mode: 'ciba',
      status: 'pending',
      customerId,
      subject: auth.subject,
      authReqId: data.auth_req_id,
      createdAt: now,
      expiresAt: now + Number(data.expires_in ?? 300) * 1000,
      pollAfterSeconds: Number(data.interval ?? 5)
    };
    approvals.set(approvalId, approval);
    logEvent('mcp-ciba', 'backchannel-pending', {
      approvalId,
      expiresIn: data.expires_in,
      pollAfterSeconds: approval.pollAfterSeconds
    });
    return pendingResponse(approval);
  }

  async function pollPaymentApproval({ approvalId, auth }) {
    const approval = approvals.get(approvalId);
    if (!approval) {
      return {
        status: 'not_found',
        approvalId,
        message: 'Payment approval request was not found.'
      };
    }

    if (approval.subject !== auth.subject) {
      return {
        status: 'denied',
        approvalId,
        message: 'Payment approval belongs to a different subject.'
      };
    }

    if (approval.expiresAt <= Date.now()) {
      approval.status = 'expired';
      return {
        status: 'expired',
        approvalId,
        message: 'Payment approval expired. Please ask again.'
      };
    }

    if (approval.status === 'approved') return approvedResponse(approval);

    if (approval.mode === 'mock') {
      if (Date.now() < approval.mockReadyAt) return pendingResponse(approval);
      approval.status = 'approved';
      logEvent('mcp-ciba', 'mock-approved', {
        approvalId,
        customerId: approval.customerId
      });
      return approvedResponse(approval);
    }

    const response = await pollCibaToken(approval);
    return response;
  }

  async function pollCibaToken(approval) {
    const endpoint = authConfig.tokenEndpoint;
    const body = new URLSearchParams({
      grant_type: cibaGrantType,
      auth_req_id: approval.authReqId
    });
    const headers = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${serviceConfig.cibaClientId}:${serviceConfig.cibaClientSecret}`).toString('base64')}`
    };

    logEvent('mcp-ciba', 'poll', {
      endpoint,
      approvalId: approval.approvalId
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok && data.access_token) {
      approval.status = 'approved';
      logEvent('mcp-ciba', 'approved', {
        approvalId: approval.approvalId,
        tokenType: data.token_type,
        expiresIn: data.expires_in
      });
      return approvedResponse(approval);
    }

    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      if (data.error === 'slow_down') approval.pollAfterSeconds += 2;
      return pendingResponse(approval);
    }

    approval.status = data.error === 'access_denied' ? 'denied' : 'failed';
    logEvent('mcp-ciba', 'failed', {
      approvalId: approval.approvalId,
      status: response.status,
      error: data.error
    });
    return {
      status: approval.status,
      approvalId: approval.approvalId,
      message: data.error_description ?? data.error ?? 'Payment approval failed.'
    };
  }

  return {
    startPaymentApproval,
    pollPaymentApproval
  };
}

function ensureCibaConfig(config, authConfig) {
  const missing = [];
  if (!config.cibaClientId) missing.push('CIBA_CLIENT_ID');
  if (!config.cibaClientSecret) missing.push('CIBA_CLIENT_SECRET');
  if (!authConfig.backchannelAuthenticationEndpoint) missing.push('OIDC discovery backchannel_authentication_endpoint');
  if (!authConfig.tokenEndpoint) missing.push('OIDC discovery token_endpoint');
  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} required for payment CIBA approval`);
  }
}

function pendingResponse(approval) {
  return {
    status: 'approval_pending',
    approvalId: approval.approvalId,
    message: 'Payment data requires customer approval. Please approve the request on your trusted device.',
    pollAfterSeconds: approval.pollAfterSeconds,
    expiresAt: new Date(approval.expiresAt).toISOString()
  };
}

function approvedResponse(approval) {
  return {
    status: 'approved',
    approvalId: approval.approvalId,
    message: 'Payment approval completed.',
    paymentSummary: payments[approval.customerId] ?? null
  };
}
