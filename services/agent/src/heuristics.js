export function classifyQuestion(text) {
  const normalized = normalizeQuestion(text);
  const intents = new Set();

  if (
    /\b(plan|plans|profile|service|services|usage|data|device|devices|router|sim|speed|fiber|mobile|subscription|package|tariff|contract)\b/.test(
      normalized
    )
  ) {
    intents.add('profile');
  }

  if (/\b(bill|bills|billing|payment|payments|pay|invoice|invoices|due|balance|autopay|charge|charges|amount|statement|statements)\b/.test(normalized)) {
    intents.add('payments');
  }

  if (/\b(outage|down|not working|slow|support|ticket|help)\b/.test(normalized)) {
    intents.add('support');
  }

  if (intents.size === 0) {
    intents.add('general');
  }

  return [...intents];
}

export function toolsForQuestion(text) {
  const intents = classifyQuestion(text);
  const tools = [];
  if (intents.includes('profile')) tools.push('get_customer_profile');
  if (intents.includes('payments')) tools.push('get_payment_summary');
  return tools;
}

export function buildAnswer(question, toolResults) {
  const lines = [];
  const profileFocus = classifyProfileFocus(question);
  const profile = toolResults.find((result) => result.tool === 'get_customer_profile' && result.data && !result.error);
  const payments = toolResults.find((result) => result.tool === 'get_payment_summary' && result.data && !result.error);
  const approval = toolResults.find((result) => result.data?.status === 'approval_pending')?.data;
  const denied = toolResults.filter((result) => result.error?.status === 403 || /Missing required scope/.test(result.error?.message ?? ''));
  const failed = toolResults.filter((result) => result.error && !denied.includes(result));

  if (profile) {
    const data = profile.data;
    if (profileFocus.includes('plan')) {
      lines.push(
        `Your current plan is ${data.plan}. The account is ${data.status}, your loyalty tier is ${data.loyaltyTier}, and your billing cycle ends on ${data.usage.billingCycleEndsOn}.`
      );
    }

    if (profileFocus.includes('usage')) {
      lines.push(
        `Current usage is ${data.usage.mobileDataGb} GB mobile data and ${data.usage.homeDataGb} GB home data. The current cycle ends on ${data.usage.billingCycleEndsOn}.`
      );
    }

    if (profileFocus.includes('devices') && Array.isArray(data.devices) && data.devices.length > 0) {
      const deviceLines = data.devices.map((device) => {
        const name = device.model ?? device.label ?? device.type;
        return `- ${name}: ${device.status}`;
      });
      lines.push(`Your registered devices are:\n${deviceLines.join('\n')}`);
    }
  }

  if (payments && payments.data.status !== 'approval_pending') {
    const data = payments.data;
    lines.push(
      `Your current balance is ${data.currency} ${data.balanceDue.toFixed(2)}, due on ${data.dueDate}. Autopay is ${data.autopay ? 'enabled' : 'disabled'}.`
    );
    lines.push(`Your last payment was ${data.currency} ${data.lastPayment.amount.toFixed(2)} on ${data.lastPayment.date}.`);
    if (Array.isArray(data.invoices) && data.invoices.length > 0) {
      const invoiceLines = data.invoices
        .slice(0, 4)
        .map((invoice) => {
          const period = invoice.period ?? invoice.id;
          const due = invoice.dueDate ? `, due ${invoice.dueDate}` : '';
          return `- ${period}: ${data.currency} ${invoice.amount.toFixed(2)} (${invoice.status}${due})`;
        });
      lines.push(`Recent bills:\n${invoiceLines.join('\n')}`);
    }
  }

  if (approval) {
    lines.push(approval.message);
  }

  if (denied.length > 0) {
    const missing = denied.map((result) => result.requiredScope).filter(Boolean).join(', ');
    lines.push(
      `I can answer that after you sign in with the required access${missing ? ` (${missing})` : ''}.`
    );
  }

  if (failed.length > 0) {
    lines.push(
      `I understood your question, but I could not retrieve the required telco data right now. ${failed.map((result) => `${result.tool}: ${result.error.message}`).join('; ')}`
    );
  }

  if (lines.length === 0) {
    lines.push(
      'I can help with your telco plan, usage, devices, billing, invoices, payments, and support status. Try asking about your plan or latest bill.'
    );
  }

  return {
    answer: lines.join('\n\n'),
    intent: classifyQuestion(question),
    approval
  };
}

function classifyProfileFocus(text) {
  const normalized = normalizeQuestion(text);
  const focus = new Set();

  if (/\b(device|devices|router|sim)\b/.test(normalized)) focus.add('devices');
  if (/\b(usage|data|speed)\b/.test(normalized)) focus.add('usage');
  if (/\b(plan|plans|profile|service|services|fiber|mobile|subscription|package|tariff|contract)\b/.test(normalized)) {
    focus.add('plan');
  }

  if (focus.size === 0) {
    focus.add('plan');
    focus.add('usage');
    focus.add('devices');
  }

  return [...focus];
}

function normalizeQuestion(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
