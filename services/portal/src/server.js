import express from 'express';
import cors from 'cors';
import { decodeJwt, UnsecuredJWT } from 'jose';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { authMiddleware, staticDemoToken, verifyIdToken } from '@telco-demo/shared/auth';
import { loadOidcConfig, serviceConfig } from '@telco-demo/shared/config';
import { asyncHandler, errorHandler, getJson, postJson } from '@telco-demo/shared/http';
import { logEvent } from '@telco-demo/shared/logger';
import { chatRequestSchema, oidcTokenExchangeSchema, toAgentTask } from '@telco-demo/shared/protocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public');

const service = serviceConfig();
const authConfig = await loadOidcConfig({ expectedAudience: service.apiExpectedAudience });
const app = express();
const identityClaimsByAccessToken = new Map();

app.use(cors({ origin: service.allowedOrigins }));
app.use(express.json());
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      logEvent('portal-api', 'request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - started
      });
    }
  });
  next();
});
app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'portal' });
});

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(
    `window.TELCO_CONFIG = ${JSON.stringify({
      authMode: authConfig.authMode,
      issuer: authConfig.issuer,
      clientId: authConfig.clientId,
      authorizationEndpoint: authConfig.authorizationEndpoint,
      tokenEndpoint: authConfig.tokenEndpoint,
      redirectUri: authConfig.redirectUri,
      scopes: authConfig.scopes,
      devAuthEnabled: service.devAuthEnabled,
      noSecurity: service.noSecurity
    })};`
  );
});

app.post('/api/dev-token', asyncHandler(async (_req, res) => {
  if (service.noSecurity || authConfig.authMode === 'no_security') {
    logEvent('portal-api', 'static-login', {
      subject: 'static-demo-user',
      mode: 'no_security'
    });
    res.json({
      access_token: staticDemoToken,
      token_type: 'Bearer',
      expires_in: 86400
    });
    return;
  }

  if (!service.devAuthEnabled || authConfig.authMode !== 'dev') {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  logEvent('portal-api', 'dev-login', {
    subject: 'demo-user',
    mode: 'dev'
  });
  const token = await new UnsecuredJWT({
    sub: 'demo-user',
    name: 'Federico Carbone',
    customer_id: 'cust-1001',
    scope: authConfig.scopes.join(' ')
  })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer('telco-demo-dev')
    .setAudience(service.apiExpectedAudience || 'telco-demo')
    .encode();

  res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: 3600
  });
}));

app.post('/api/oidc/token', asyncHandler(async (req, res) => {
  const input = oidcTokenExchangeSchema.parse(req.body);
  if (authConfig.noSecurity || authConfig.authMode !== 'jwks') {
    res.status(400).json({
      error: 'invalid_auth_mode',
      message: 'OIDC token exchange is only available when AUTH_MODE is jwks'
    });
    return;
  }

  logEvent('portal-api', 'oidc-token-exchange-start', {
    redirectUri: input.redirectUri,
    hasCodeVerifier: Boolean(input.codeVerifier)
  });

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier
  });
  const headers = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded'
  };

  if (authConfig.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${authConfig.clientId}:${authConfig.clientSecret}`).toString('base64')}`;
  } else {
    body.set('client_id', authConfig.clientId);
  }

  const response = await fetch(authConfig.tokenEndpoint, {
    method: 'POST',
    headers,
    body
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    logEvent('portal-api', 'oidc-token-exchange-failed', {
      status: response.status,
      error: token.error
    });
    res.status(502).json({
      error: 'token_exchange_failed',
      message: token.error_description ?? token.error ?? `Token endpoint returned HTTP ${response.status}`
    });
    return;
  }

  logEvent('portal-api', 'oidc-token-exchange-success', {
    tokenType: token.token_type,
    expiresIn: token.expires_in,
    hasAccessToken: Boolean(token.access_token),
    hasIdToken: Boolean(token.id_token)
  });

  if (token.access_token && token.id_token) {
    try {
      const idClaims = await verifyIdToken(token.id_token, authConfig);
      rememberIdentityClaims(token.access_token, idClaims, token.expires_in);
      logEvent('portal-api', 'id-token-claims-cached', {
        subject: idClaims.sub,
        hasName: Boolean(idClaims.name),
        hasEmail: Boolean(idClaims.email)
      });
    } catch (error) {
      logEvent('portal-api', 'id-token-verify-failed', {
        message: error.message
      });
    }
  }

  res.json({
    access_token: token.access_token,
    token_type: token.token_type,
    expires_in: token.expires_in,
    scope: token.scope
  });
}));

app.get('/api/me', authMiddleware({ config: authConfig }), (req, res) => {
  const idClaims = getIdentityClaims(req.auth.token);
  res.json({
    subject: req.auth.subject,
    customerId: req.auth.customerId,
    scopes: req.auth.scopes,
    claims: {
      name: idClaims?.name ?? req.auth.payload.name,
      givenName: idClaims?.given_name ?? req.auth.payload.given_name,
      familyName: idClaims?.family_name ?? req.auth.payload.family_name,
      email: idClaims?.email ?? req.auth.payload.email,
      username: idClaims?.preferred_username ?? req.auth.payload.username
    },
    accessTokenClaims: req.auth.payload,
    idTokenClaims: idClaims ?? null
  });
});

app.post(
  '/api/chat',
  authMiddleware({ config: authConfig }),
  asyncHandler(async (req, res) => {
    const input = chatRequestSchema.parse(req.body);
    const task = toAgentTask(input);
    logEvent('portal-api', 'chat-forward', {
      taskId: task.id,
      conversationId: input.conversationId ?? task.id,
      subject: req.auth.subject,
      messageLength: input.message.length,
      tokenExchangeScope: service.agentTokenExchangeScope
    });
    const agentToken = await exchangeTokenForAgent(req.auth.token);
    const agentResponse = await postJson(`${service.agentUrl}/a2a/message`, task, {
      token: agentToken
    });
    logEvent('portal-api', 'chat-response', {
      taskId: task.id,
      toolCalls: agentResponse.result.metadata.toolCalls?.map((call) => `${call.tool}:${call.ok ? 'ok' : 'error'}`)
    });

    res.json({
      conversationId: agentResponse.result.conversationId ?? input.conversationId ?? task.id,
      message: agentResponse.result.message.parts.map((part) => part.text).join('\n'),
      toolCalls: agentResponse.result.metadata.toolCalls,
      approval: agentResponse.result.metadata.approval
    });
  })
);

app.get(
  '/api/approvals/:approvalId',
  authMiddleware({ config: authConfig }),
  asyncHandler(async (req, res) => {
    const agentToken = await exchangeTokenForAgent(req.auth.token);
    const approval = await getJson(`${service.agentUrl}/a2a/approvals/${req.params.approvalId}`, {
      token: agentToken
    });
    logEvent('portal-api', 'approval-status', {
      approvalId: req.params.approvalId,
      status: approval.status
    });
    res.json(approval);
  })
);

app.get('*', (_req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

app.use(errorHandler());

app.listen(service.portalPort, '127.0.0.1', () => {
  console.log(`Portal listening on http://127.0.0.1:${service.portalPort}`);
});

function rememberIdentityClaims(accessToken, claims, expiresIn) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number.isInteger(claims.exp) ? claims.exp : now + Number(expiresIn ?? 3600);
  identityClaimsByAccessToken.set(accessToken, {
    claims,
    expiresAt
  });
}

function getIdentityClaims(accessToken) {
  const entry = identityClaimsByAccessToken.get(accessToken);
  if (!entry) return null;

  const now = Math.floor(Date.now() / 1000);
  if (entry.expiresAt <= now) {
    identityClaimsByAccessToken.delete(accessToken);
    return null;
  }

  return entry.claims;
}

async function exchangeTokenForAgent(accessToken) {
  if (authConfig.noSecurity || authConfig.authMode === 'no_security' || authConfig.authMode === 'dev') {
    return accessToken || staticDemoToken;
  }

  if (!service.agentTokenExchangeScope) {
    const error = new Error('AGENT_TOKEN_EXCHANGE_SCOPE is required before calling the agent');
    error.status = 500;
    throw error;
  }
  if (!service.apiOauthClientId || !service.apiOauthClientSecret) {
    const error = new Error('API_OAUTH_CLIENT_ID and API_OAUTH_CLIENT_SECRET are required for agent token exchange');
    error.status = 500;
    throw error;
  }

  const inboundTokenClaims = decodeTokenClaims(accessToken);

  logEvent('portal-api', 'agent-token-exchange-start', {
    endpoint: authConfig.tokenEndpoint,
    scope: service.agentTokenExchangeScope,
    clientId: service.apiOauthClientId,
    inboundTokenClaims
  });

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: accessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: service.agentTokenExchangeScope
  });
  const headers = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded'
  };

  headers.authorization = `Basic ${Buffer.from(`${service.apiOauthClientId}:${service.apiOauthClientSecret}`).toString('base64')}`;

  const response = await fetch(authConfig.tokenEndpoint, {
    method: 'POST',
    headers,
    body
  });
  const exchanged = await response.json().catch(() => ({}));
  if (!response.ok || !exchanged.access_token) {
    logEvent('portal-api', 'agent-token-exchange-failed', {
      endpoint: authConfig.tokenEndpoint,
      status: response.status,
      error: exchanged.error,
      inboundTokenClaims
    });
    const error = new Error(
      exchanged.error_description ?? exchanged.error ?? `Token exchange failed with HTTP ${response.status}`
    );
    error.status = 502;
    throw error;
  }

  const outboundTokenClaims = decodeTokenClaims(exchanged.access_token);

  logEvent('portal-api', 'agent-token-exchange-success', {
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
