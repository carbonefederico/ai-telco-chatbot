import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolContent } from './mcp-client.js';

test('parseToolContent parses successful JSON tool text', () => {
  const parsed = parseToolContent({
    content: [{ type: 'text', text: '{"balanceDue":76.45}' }]
  });

  assert.equal(parsed.balanceDue, 76.45);
});

test('parseToolContent preserves MCP tool error text and status', () => {
  assert.throws(
    () =>
      parseToolContent({
        isError: true,
        content: [{ type: 'text', text: 'Missing required scope: customer-support-agent:customer-mcp:payments:read' }]
      }),
    (error) => {
      assert.equal(error.message, 'Missing required scope: customer-support-agent:customer-mcp:payments:read');
      assert.equal(error.status, 403);
      return true;
    }
  );
});
