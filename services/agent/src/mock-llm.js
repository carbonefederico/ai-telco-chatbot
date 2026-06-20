import { buildAnswer, toolsForQuestion } from './heuristics.js';

export const telcoTools = [
  {
    type: 'function',
    function: {
      name: 'get_customer_profile',
      description: 'Read the customer telco profile, active plan, devices, status, and usage.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_summary',
      description: 'Read the customer payment summary, bill balance, due date, and autopay status.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  }
];

export async function mockChatCompletion({ model = 'mock-telco-support', messages, tools = [] }) {
  const lastMessage = messages.at(-1);
  const id = `mockcmpl-${Date.now()}`;

  if (lastMessage?.role === 'user') {
    const requestedTools = toolsForQuestion(lastMessage.content);
    const allowedToolNames = new Set(tools.map((tool) => tool.function?.name).filter(Boolean));
    const toolCalls = requestedTools
      .filter((toolName) => allowedToolNames.has(toolName))
      .map((toolName, index) => ({
        id: `call_${index + 1}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: '{}'
        }
      }));

    return {
      id,
      object: 'chat.completion',
      model,
      choices: [
        {
          index: 0,
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          message: {
            role: 'assistant',
            content: toolCalls.length > 0 ? null : buildAnswer(lastMessage.content, []).answer,
            tool_calls: toolCalls
          }
        }
      ]
    };
  }

  const originalQuestion = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const toolResults = messages
    .filter((message) => message.role === 'tool')
    .map((message) => JSON.parse(message.content));
  const response = buildAnswer(originalQuestion, toolResults);

  return {
    id,
    object: 'chat.completion',
    model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: response.answer
        }
      }
    ],
    metadata: {
      intent: response.intent,
      approval: response.approval
    }
  };
}
