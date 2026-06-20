import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['packages', 'services', 'scripts'];
const errors = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      await walk(path);
    } else if (entry.isFile() && path.endsWith('.js')) {
      await checkFile(path);
    }
  }
}

async function checkFile(path) {
  const text = await readFile(path, 'utf8');
  if (/\t/.test(text)) {
    errors.push(`${path}: tabs are not allowed`);
  }
  if (/[ \t]+$/m.test(text)) {
    errors.push(`${path}: trailing whitespace`);
  }
}

for (const root of roots) {
  await walk(root);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
