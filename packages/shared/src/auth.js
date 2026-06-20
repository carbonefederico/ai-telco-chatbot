import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { oidcConfig } from './config.js';

const jwksCache = new Map();
export const staticDemoToken = 'telco-demo-static-token';
export const staticDemoPayload = {
  sub: 'static-demo-user',
  name: 'Static Demo User',
  email: 'static.demo@example.com',
  customer_id: 'cust-1001',
  scope: 'openid profile customer-support-agent:customer-mcp:profile:read customer-support-agent:customer-mcp:payments:read'
};

export class AuthError extends Error {
  constructor(message, status = 401, details = undefined) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.details = details;
  }
}

export function extractBearerToken(header) {
  if (!header) throw new AuthError('Missing Authorization header');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new AuthError('Authorization header must use Bearer scheme');
  return match[1];
}

export function parseScopes(payload) {
  const values = [];
  for (const key of ['scope', 'scp', 'permissions']) {
    const raw = payload?.[key];
    if (Array.isArray(raw)) values.push(...raw);
    if (typeof raw === 'string') values.push(...raw.split(/\s+/));
  }
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

export function hasScope(auth, requiredScope) {
  return auth.scopes.includes(requiredScope);
}

export function requireScope(auth, requiredScope) {
  if (!hasScope(auth, requiredScope)) {
    throw new AuthError(`Missing required scope: ${requiredScope}`, 403, {
      requiredScope,
      scopes: auth.scopes
    });
  }
}

function getJwks(jwksUri) {
  if (!jwksUri) {
    throw new AuthError('OIDC discovery metadata must provide jwks_uri when AUTH_MODE is jwks', 500);
  }
  if (!jwksCache.has(jwksUri)) {
    jwksCache.set(jwksUri, createRemoteJWKSet(new URL(jwksUri)));
  }
  return jwksCache.get(jwksUri);
}

export async function verifyAccessToken(token, config = oidcConfig()) {
  if (config.noSecurity || config.authMode === 'no_security') {
    return normalizeAuth(staticDemoPayload, token || staticDemoToken, 'no_security');
  }

  if (config.authMode === 'dev') {
    const payload = decodeJwt(token);
    return normalizeAuth(payload, token, 'dev');
  }

  const verifyOptions = {};
  if (config.issuer) verifyOptions.issuer = config.issuer;
  if (config.audience) verifyOptions.audience = config.audience;

  const { payload } = await jwtVerify(token, getJwks(config.jwksUri), verifyOptions);
  return normalizeAuth(payload, token, 'jwks');
}

export async function verifyIdToken(token, config = oidcConfig()) {
  if (config.noSecurity || config.authMode === 'no_security') {
    return staticDemoPayload;
  }

  if (config.authMode === 'dev') {
    return decodeJwt(token);
  }

  const verifyOptions = {};
  if (config.issuer) verifyOptions.issuer = config.issuer;
  if (config.clientId) verifyOptions.audience = config.clientId;

  const { payload } = await jwtVerify(token, getJwks(config.jwksUri), verifyOptions);
  return payload;
}

export function normalizeAuth(payload, token, mode) {
  const scopes = parseScopes(payload);
  return {
    mode,
    token,
    payload,
    scopes,
    subject: payload.sub ?? 'anonymous',
    customerId:
      payload.customer_id ??
      payload.customerId ??
      payload['https://telco.example/customer_id'] ??
      payload.sub ??
      'cust-1001'
  };
}

export function authMiddleware(options = {}) {
  const config = options.config ?? oidcConfig();
  return async (req, res, next) => {
    try {
      if (config.noSecurity || config.authMode === 'no_security') {
        req.auth = await verifyAccessToken(staticDemoToken, config);
        next();
        return;
      }

      const token = extractBearerToken(req.headers.authorization);
      req.auth = await verifyAccessToken(token, config);
      next();
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 401;
      res.status(status).json({
        error: status === 403 ? 'forbidden' : 'unauthorized',
        message: error.message
      });
    }
  };
}
