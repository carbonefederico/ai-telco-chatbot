import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswer, classifyQuestion, toolsForQuestion } from './heuristics.js';

test('classifyQuestion detects profile and payment intents', () => {
  assert.deepEqual(classifyQuestion('What is my plan and current bill?'), ['profile', 'payments']);
});

test('toolsForQuestion maps common plan and bill questions to MCP tools', () => {
  assert.deepEqual(toolsForQuestion('what is my current plan'), ['get_customer_profile']);
  assert.deepEqual(toolsForQuestion('what is my plan'), ['get_customer_profile']);
  assert.deepEqual(toolsForQuestion('show my bills'), ['get_payment_summary']);
});

test('buildAnswer returns profile data for plan questions', () => {
  const response = buildAnswer('what is my current plan', [
    {
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
    }
  ]);

  assert.match(response.answer, /Fiber Max 1 Gbps/);
});

test('buildAnswer returns device data for device questions', () => {
  const response = buildAnswer('what are my devices', [
    {
      tool: 'get_customer_profile',
      data: {
        plan: 'Fiber Max 1 Gbps + Mobile Unlimited',
        status: 'active',
        loyaltyTier: 'gold',
        devices: [
          { type: 'router', model: 'TelcoHub X6', status: 'online' },
          { type: 'sim', label: 'Primary mobile SIM', status: 'active' }
        ],
        usage: {
          billingCycleEndsOn: '2026-06-30',
          mobileDataGb: 42.8,
          homeDataGb: 812
        }
      }
    }
  ]);

  assert.match(response.answer, /Your registered devices are:/);
  assert.match(response.answer, /TelcoHub X6: online/);
  assert.match(response.answer, /Primary mobile SIM: active/);
  assert.doesNotMatch(response.answer, /Current usage is/);
});

test('buildAnswer includes scoped denial when a payment tool is forbidden', () => {
  const response = buildAnswer('What is my bill?', [
    {
      tool: 'get_payment_summary',
      error: { status: 403, message: 'Missing required scope: customer-support-agent:customer-mcp:payments:read' },
      requiredScope: 'customer-support-agent:customer-mcp:payments:read'
    }
  ]);

  assert.match(response.answer, /customer-support-agent:customer-mcp:payments:read/);
});

test('buildAnswer lists recent bills for payment questions', () => {
  const response = buildAnswer('show my bills', [
    {
      tool: 'get_payment_summary',
      data: {
        balanceDue: 76.45,
        currency: 'EUR',
        dueDate: '2026-06-27',
        autopay: true,
        lastPayment: {
          amount: 76.45,
          date: '2026-05-28'
        },
        invoices: [
          { id: 'inv-2026-06', period: 'June 2026', dueDate: '2026-06-27', amount: 76.45, status: 'open' },
          { id: 'inv-2026-05', period: 'May 2026', dueDate: '2026-05-27', amount: 76.45, status: 'paid' },
          { id: 'inv-2026-04', period: 'April 2026', dueDate: '2026-04-27', amount: 74.9, status: 'paid' }
        ]
      }
    }
  ]);

  assert.match(response.answer, /Recent bills:/);
  assert.match(response.answer, /June 2026: EUR 76\.45 \(open, due 2026-06-27\)/);
  assert.match(response.answer, /May 2026: EUR 76\.45 \(paid, due 2026-05-27\)/);
});
