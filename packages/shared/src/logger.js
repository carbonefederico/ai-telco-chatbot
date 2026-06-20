export function logEvent(component, event, details = {}) {
  const timestamp = new Date().toISOString();
  const entries = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  const singleLineFields = entries.filter((entry) => !entry.includes('\n'));
  const multiLineFields = entries.filter((entry) => entry.includes('\n'));
  const prefix = `[${timestamp}] [${component}] ${event}`;
  const firstLine = singleLineFields.length ? `${prefix} ${singleLineFields.join(' ')}` : prefix;
  console.log([firstLine, ...multiLineFields].join('\n'));
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object') return `\n${JSON.stringify(value, null, 2)}`;
  return String(value).replace(/\s+/g, '_');
}
