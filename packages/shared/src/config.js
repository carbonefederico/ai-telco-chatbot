import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharedDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(sharedDir, '../../../.env') });
dotenv.config();

export function readNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function readBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function readCsv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function oidcConfig() {
  const noSecurity = readBoolean('NO_SECURITY', false);
  const clientId = process.env.OIDC_CLIENT_ID ?? '';
  return {
    noSecurity,
    authMode: noSecurity ? 'no_security' : process.env.AUTH_MODE ?? 'jwks',
    discoveryUri: process.env.OIDC_DISCOVERY_URI ?? '',
    issuer: '',
    jwksUri: '',
    audience: '',
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    backchannelAuthenticationEndpoint: '',
    redirectUri: process.env.OIDC_REDIRECT_URI ?? 'http://localhost:3000/callback',
    scopes: readCsv('OIDC_SCOPES', [
      'openid',
      'profile',
      'customer-support-agent:customer-mcp:profile:read',
      'customer-support-agent:customer-mcp:payments:read'
    ])
  };
}

export async function loadOidcConfig(options = {}) {
  const config = oidcConfig();
  const expectedAudience = options.expectedAudience ?? '';
  config.audience = expectedAudience;
  if (config.noSecurity || config.authMode === 'dev') return config;
  if (!config.discoveryUri) {
    throw new Error('OIDC_DISCOVERY_URI is required when AUTH_MODE is jwks');
  }
  if (!config.clientId) {
    throw new Error('OIDC_CLIENT_ID is required when AUTH_MODE is jwks');
  }

  const response = await fetch(config.discoveryUri, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`Failed to load OIDC discovery metadata: HTTP ${response.status}`);
  }

  const metadata = await response.json();
  const loaded = {
    ...config,
    issuer: config.issuer || metadata.issuer || '',
    jwksUri: config.jwksUri || metadata.jwks_uri || '',
    authorizationEndpoint:
      config.authorizationEndpoint || metadata.authorization_endpoint || '',
    tokenEndpoint: config.tokenEndpoint || metadata.token_endpoint || '',
    backchannelAuthenticationEndpoint: metadata.backchannel_authentication_endpoint || ''
  };
  for (const key of ['issuer', 'jwksUri', 'authorizationEndpoint', 'tokenEndpoint']) {
    if (!loaded[key]) {
      throw new Error(`OIDC discovery metadata is missing ${key}`);
    }
  }
  return loaded;
}

export function serviceConfig() {
  return {
    portalPort: readNumber('PORTAL_PORT', 3000),
    agentPort: readNumber('AGENT_PORT', 3001),
    mcpPort: readNumber('MCP_PORT', 3002),
    agentUrl: process.env.AGENT_URL ?? 'http://localhost:3001',
    mcpUrl: process.env.MCP_URL ?? 'http://localhost:3002/mcp',
    allowedOrigins: readCsv('ALLOWED_ORIGINS', ['http://localhost:3000']),
    apiExpectedAudience: process.env.API_EXPECTED_AUDIENCE ?? '',
    agentExpectedAudience: process.env.AGENT_EXPECTED_AUDIENCE ?? '',
    mcpExpectedAudience: process.env.MCP_EXPECTED_AUDIENCE ?? '',
    agentTokenExchangeScope: process.env.AGENT_TOKEN_EXCHANGE_SCOPE ?? '',
    apiOauthClientId: process.env.API_OAUTH_CLIENT_ID ?? '',
    apiOauthClientSecret: process.env.API_OAUTH_CLIENT_SECRET ?? '',
    mcpTokenExchangeScope: process.env.MCP_TOKEN_EXCHANGE_SCOPE ?? '',
    agentOauthClientId: process.env.AGENT_OAUTH_CLIENT_ID ?? '',
    agentOauthClientSecret: process.env.AGENT_OAUTH_CLIENT_SECRET ?? '',
    cibaClientId: process.env.CIBA_CLIENT_ID ?? '',
    cibaClientSecret: process.env.CIBA_CLIENT_SECRET ?? '',
    cibaScope: process.env.CIBA_SCOPE ?? '',
    cibaMockApprovalSeconds: readNumber('CIBA_MOCK_APPROVAL_SECONDS', 8),
    devAuthEnabled: readBoolean('DEV_AUTH_ENABLED', false),
    noSecurity: readBoolean('NO_SECURITY', false)
  };
}
