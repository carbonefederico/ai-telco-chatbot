import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { extractBearerToken, staticDemoToken, verifyAccessToken } from '@telco-demo/shared/auth';
import { loadOidcConfig, serviceConfig } from '@telco-demo/shared/config';
import { logEvent } from '@telco-demo/shared/logger';
import { createCibaService } from './ciba.js';
import { registerTelcoTools } from './tools.js';

const service = serviceConfig();
const authConfig = await loadOidcConfig({ expectedAudience: service.mcpExpectedAudience });
const app = express();
const cibaService = createCibaService(service, authConfig);

app.use(cors({ origin: service.allowedOrigins }));
app.use(express.json());
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    logEvent('mcp-http', 'request', {
      method: req.method,
      path: req.path,
      sessionId: req.headers['mcp-session-id'],
      status: res.statusCode,
      durationMs: Date.now() - started
    });
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mcp-server' });
});

async function mcpAuth(req, res, next) {
  try {
    const token = authConfig.noSecurity ? staticDemoToken : extractBearerToken(req.headers.authorization);
    const auth = await verifyAccessToken(token, authConfig);
    logEvent('mcp-auth', 'accepted', {
      mode: auth.mode,
      subject: auth.subject,
      customerId: auth.customerId,
      scopes: auth.scopes
    });
    req.auth = {
      token,
      clientId: auth.payload.client_id ?? auth.payload.azp ?? 'telco-demo',
      scopes: auth.scopes,
      expiresAt: auth.payload.exp,
      extra: {
        customerId: auth.customerId,
        subject: auth.subject,
        claims: auth.payload
      }
    };
    next();
  } catch (error) {
    logEvent('mcp-auth', 'rejected', {
      message: error.message
    });
    res.status(error.status ?? 401).json({
      error: 'unauthorized',
      message: error.message
    });
  }
}

function createServer() {
  const server = new McpServer(
    {
      name: 'telco-demo-mcp-server',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );
  registerTelcoTools(server, cibaService);
  return server;
}

const transports = new Map();

app.post('/mcp', mcpAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  try {
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport && !sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          logEvent('mcp-http', 'session-created', { sessionId: newSessionId });
          transports.set(newSessionId, transport);
        }
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          logEvent('mcp-http', 'session-closed', { sessionId: transport.sessionId });
          transports.delete(transport.sessionId);
        }
      };

      const server = createServer();
      await server.connect(transport);
    }

    if (!transport) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: invalid or missing MCP session' },
        id: null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: error.message },
        id: null
      });
    }
  }
});

app.get('/mcp', mcpAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Invalid or missing MCP session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', mcpAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Invalid or missing MCP session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.get('/approvals/:approvalId', mcpAuth, async (req, res) => {
  const result = await cibaService.pollPaymentApproval({
    approvalId: req.params.approvalId,
    auth: {
      subject: req.auth.extra.subject,
      customerId: req.auth.extra.customerId,
      scopes: req.auth.scopes
    }
  });
  res.json(result);
});

app.listen(service.mcpPort, '127.0.0.1', () => {
  console.log(`MCP server listening on http://127.0.0.1:${service.mcpPort}/mcp`);
});
