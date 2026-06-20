import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOidcConfig, serviceConfig } from './config.js';

test('loadOidcConfig overlays OIDC discovery metadata', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  process.env = {
    OIDC_DISCOVERY_URI: 'https://auth.example.com/as/.well-known/openid-configuration',
    OIDC_CLIENT_ID: 'client-123'
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, process.env.OIDC_DISCOVERY_URI);
    return {
      ok: true,
      async json() {
        return {
          issuer: 'https://auth.example.com/as',
          jwks_uri: 'https://auth.example.com/as/jwks',
          authorization_endpoint: 'https://auth.example.com/as/authorize',
          token_endpoint: 'https://auth.example.com/as/token',
          backchannel_authentication_endpoint: 'https://auth.example.com/as/bc-authorize'
        };
      }
    };
  };

  try {
    const config = await loadOidcConfig({ expectedAudience: 'api-audience' });

    assert.equal(config.issuer, 'https://auth.example.com/as');
    assert.equal(config.jwksUri, 'https://auth.example.com/as/jwks');
    assert.equal(config.authorizationEndpoint, 'https://auth.example.com/as/authorize');
    assert.equal(config.tokenEndpoint, 'https://auth.example.com/as/token');
    assert.equal(config.backchannelAuthenticationEndpoint, 'https://auth.example.com/as/bc-authorize');
    assert.equal(config.clientId, 'client-123');
    assert.equal(config.audience, 'api-audience');
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

test('loadOidcConfig fails fast when discovery uri is missing in jwks mode', async () => {
  const originalEnv = { ...process.env };
  process.env = {
    AUTH_MODE: 'jwks',
    OIDC_CLIENT_ID: 'client-123'
  };

  try {
    await assert.rejects(loadOidcConfig(), /OIDC_DISCOVERY_URI is required/);
  } finally {
    process.env = originalEnv;
  }
});

test('serviceConfig reads per-service expected audiences', () => {
  const originalEnv = { ...process.env };
  process.env = {
    API_EXPECTED_AUDIENCE: 'portal-api',
    AGENT_EXPECTED_AUDIENCE: 'agent-api',
    MCP_EXPECTED_AUDIENCE: 'mcp-api',
    AGENT_TOKEN_EXCHANGE_SCOPE: 'agent.invoke',
    API_OAUTH_CLIENT_ID: 'portal-backend-client',
    API_OAUTH_CLIENT_SECRET: 'portal-backend-secret',
    MCP_TOKEN_EXCHANGE_SCOPE: 'mcp.profile mcp.payments',
    AGENT_OAUTH_CLIENT_ID: 'agent-backend-client',
    AGENT_OAUTH_CLIENT_SECRET: 'agent-backend-secret',
    CIBA_CLIENT_ID: 'ciba-client',
    CIBA_CLIENT_SECRET: 'ciba-secret',
    CIBA_SCOPE: 'payments.approve',
    CIBA_MOCK_APPROVAL_SECONDS: '2'
  };

  try {
    const config = serviceConfig();

    assert.equal(config.apiExpectedAudience, 'portal-api');
    assert.equal(config.agentExpectedAudience, 'agent-api');
    assert.equal(config.mcpExpectedAudience, 'mcp-api');
    assert.equal(config.agentTokenExchangeScope, 'agent.invoke');
    assert.equal(config.apiOauthClientId, 'portal-backend-client');
    assert.equal(config.apiOauthClientSecret, 'portal-backend-secret');
    assert.equal(config.mcpTokenExchangeScope, 'mcp.profile mcp.payments');
    assert.equal(config.agentOauthClientId, 'agent-backend-client');
    assert.equal(config.agentOauthClientSecret, 'agent-backend-secret');
    assert.equal(config.cibaClientId, 'ciba-client');
    assert.equal(config.cibaClientSecret, 'ciba-secret');
    assert.equal(config.cibaScope, 'payments.approve');
    assert.equal(config.cibaMockApprovalSeconds, 2);
  } finally {
    process.env = originalEnv;
  }
});
