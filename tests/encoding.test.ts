import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css|html|json)$/.test(name) ? [path] : [];
  });
}

test('every source file is valid UTF-8 (non-ASCII text such as ✓ or ▸ must not be written in a Windows code page)', () => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const bad: string[] = [];
  for (const file of [...sourceFiles('src'), ...sourceFiles('tests')]) {
    try {
      decoder.decode(readFileSync(file));
    } catch {
      bad.push(file);
    }
  }
  assert.deepEqual(bad, []);
});
