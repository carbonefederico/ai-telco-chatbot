import test from 'node:test';
import assert from 'node:assert/strict';
import { mockChatCompletion, telcoTools } from './mock-llm.js';

test('mockChatCompletion returns OpenAI-style tool calls for bill questions', async () => {
  const response = await mockChatCompletion({
    messages: [{ role: 'user', content: 'show my bills' }],
    tools: telcoTools
  });

  const choice = response.choices[0];
  assert.equal(choice.finish_reason, 'tool_calls');
  assert.equal(choice.message.role, 'assistant');
  assert.equal(choice.message.tool_calls[0].function.name, 'get_payment_summary');
  assert.equal(choice.message.tool_calls[0].function.arguments, '{}');
});

test('mockChatCompletion returns final assistant content from tool messages', async () => {
  const response = await mockChatCompletion({
    messages: [
      { role: 'user', content: 'what is my plan?' },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'get_customer_profile',
        content: JSON.stringify({
          tool: 'get_customer_profile',
          data: {
            plan: 'Fiber Max 1 Gbps + Mobile Unlimited',
            status: 'active',
            loyaltyTier: 'gold',
            usage: {
              billingCycleEndsOn: '2026-06-30',
              mobileDataGb: 42.8,
              homeDataGb: 812
            }
          }
        })
      }
    ],
    tools: telcoTools
  });

  assert.equal(response.choices[0].finish_reason, 'stop');
  assert.match(response.choices[0].message.content, /Fiber Max 1 Gbps/);
});
