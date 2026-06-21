import test from 'node:test';
import assert from 'node:assert/strict';
import { authMiddleware, parseScopes, staticDemoToken, verifyAccessToken } from './auth.js';

test('parseScopes accepts common scope claim shapes', () => {
  const scopes = parseScopes({
    scope: 'openid profile customer-support-agent:customer-mcp:profile:read',
    scp: ['customer-support-agent:customer-mcp:payments:read'],
    permissions: 'support:chat'
  });

  assert.deepEqual(scopes.sort(), [
    'customer-support-agent:customer-mcp:payments:read',
    'customer-support-agent:customer-mcp:profile:read',
    'openid',
    'profile',
    'support:chat'
  ]);
});

test('verifyAccessToken returns static auth when no security is enabled', async () => {
  const auth = await verifyAccessToken('anything', { noSecurity: true });

  assert.equal(auth.mode, 'no_security');
  assert.equal(auth.token, 'anything');
  assert.equal(auth.customerId, 'cust-1001');
  assert.ok(auth.scopes.includes('customer-support-agent:customer-mcp:profile:read'));
  assert.ok(auth.scopes.includes('customer-support-agent:customer-mcp:payments:read'));
});

test('authMiddleware bypasses missing Authorization header in no security mode', async () => {
  const middleware = authMiddleware({ config: { noSecurity: true } });
  const req = { headers: {} };
  const res = {
    status() {
      throw new Error('status should not be called');
    }
  };

  await middleware(req, res, () => undefined);

  assert.equal(req.auth.token, staticDemoToken);
  assert.equal(req.auth.subject, 'static-demo-user');
});
