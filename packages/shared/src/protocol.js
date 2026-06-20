import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  context: z.record(z.unknown()).optional()
});

export const oidcTokenExchangeSchema = z.object({
  code: z.string().min(1).max(4096),
  codeVerifier: z.string().min(32).max(256),
  redirectUri: z.string().url()
});

export const agentTaskSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: z.string().default(() => randomUUID()),
  method: z.literal('message/send'),
  params: z.object({
    message: z.object({
      role: z.literal('user'),
      parts: z.array(
        z.object({
          kind: z.literal('text'),
          text: z.string().min(1).max(2000)
        })
      )
    }),
    conversationId: z.string().optional(),
    metadata: z.record(z.unknown()).optional()
  })
});

export function toAgentTask({ message, conversationId, context }) {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      conversationId,
      metadata: context ?? {},
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: message }]
      }
    }
  };
}

export function fromAgentTask(task) {
  const parsed = agentTaskSchema.parse(task);
  return {
    id: parsed.id,
    conversationId: parsed.params.conversationId,
    text: parsed.params.message.parts.map((part) => part.text).join('\n'),
    metadata: parsed.params.metadata ?? {}
  };
}

export function toAgentResponse({ id, conversationId, text, toolCalls = [], status = 'completed', approval = null }) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      status,
      conversationId,
      message: {
        role: 'agent',
        parts: [{ kind: 'text', text }]
      },
      metadata: {
        toolCalls,
        approval
      }
    }
  };
}
