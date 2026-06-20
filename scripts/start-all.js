import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const services = [
  { name: 'mcp', command: 'npm', args: ['run', 'dev:mcp'] },
  { name: 'agent', command: 'npm', args: ['run', 'dev:agent'] },
  { name: 'portal', command: 'npm', args: ['run', 'dev:portal'] }
];

const children = new Map();
let shuttingDown = false;

function pipeWithPrefix(stream, prefix, writer) {
  const reader = createInterface({ input: stream });
  reader.on('line', (line) => writer.write(`[${prefix}] ${line}\n`));
}

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }
}

for (const service of services) {
  const child = spawn(service.command, service.args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  children.set(service.name, child);
  pipeWithPrefix(child.stdout, service.name, process.stdout);
  pipeWithPrefix(child.stderr, service.name, process.stderr);

  child.on('exit', (code, signal) => {
    children.delete(service.name);
    if (!shuttingDown) {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`[dev] ${service.name} exited with ${reason}; stopping remaining services`);
      stopAll();
      process.exitCode = code || 1;
    }
  });
}

console.log('[dev] started mcp, agent, and portal');
console.log('[dev] portal: http://127.0.0.1:3000');

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
