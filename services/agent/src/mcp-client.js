import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { serviceConfig } from '@telco-demo/shared/config';
import { logEvent } from '@telco-demo/shared/logger';
import { mcpToolScopes } from '@telco-demo/shared/scopes';

export function parseToolContent(result) {
  const text = result.content?.find((item) => item.type === 'text')?.text ?? '{}';
  if (result.isError) {
    const error = new Error(text);
    error.status = inferStatusFromToolText(text);
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = new Error(`MCP tool returned non-JSON content: ${text}`);
    parseError.cause = error;
    throw parseError;
  }
}

function inferStatusFromToolText(text) {
  if (/Missing required scope|forbidden/i.test(text)) return 403;
  if (/unauthorized|missing auth|invalid token/i.test(text)) return 401;
  return undefined;
}

export async function callMcpTools(toolNames, token) {
  if (toolNames.length === 0) return [];

  const service = serviceConfig();
  const client = new Client(
    {
      name: 'telco-demo-agent',
      version: '0.1.0'
    },
    {
      capabilities: {}
    }
  );
  const transport = new StreamableHTTPClientTransport(new URL(service.mcpUrl), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`
      }
    }
  });

  const results = [];
  try {
    logEvent('agent-mcp', 'connect', {
      url: service.mcpUrl,
      tools: toolNames
    });
    await client.connect(transport);
    for (const tool of toolNames) {
      try {
        logEvent('agent-mcp', 'tool-call', { tool });
        const result = await client.callTool({ name: tool, arguments: {} });
        const data = parseToolContent(result);
        logEvent('agent-mcp', 'tool-result', { tool, status: 'ok' });
        results.push({
          tool,
          data,
          raw: result
        });
      } catch (error) {
        logEvent('agent-mcp', 'tool-result', {
          tool,
          status: 'error',
          message: error.message
        });
        results.push({
          tool,
          error: {
            message: error.message,
            status: error.status
          },
          requiredScope: mcpToolScopes[tool]
        });
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }

  return results;
}
