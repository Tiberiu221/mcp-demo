import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { readLogTail, resolveAllowedPath } from './logTail.js';

// os.tmpdir() lives under /var on macOS, which is itself a symlink: a good real-world case.
let tmp = '';
let allowed = '';

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'mcp-demo-'));
  allowed = path.join(tmp, 'allowed');
  await mkdir(allowed);
  await writeFile(path.join(allowed, 'app.log'), 'one\ntwo\nthree\nfour\n');
});

after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test('returns the last N lines of a file inside the allow-list', async () => {
  const tail = await readLogTail(path.join(allowed, 'app.log'), 2, [allowed]);
  assert.deepEqual(tail.lines, ['three', 'four']);
});

test('refuses paths outside the allow-list, including ~/.ssh and ~/.claude', async () => {
  await assert.rejects(resolveAllowedPath('/etc/hosts', [allowed]), /Access denied/);
  // Default allow-list (Desktop + /var/log): secrets in the home folder stay out of reach.
  await assert.rejects(resolveAllowedPath('~/.ssh/id_rsa'), /Access denied/);
  await assert.rejects(resolveAllowedPath('~/.claude/settings.json'), /Access denied/);
});

test('refuses a symlink inside the allow-list that points outside it', async () => {
  const link = path.join(allowed, 'innocent.log');
  await symlink('/etc/hosts', link);
  await assert.rejects(readLogTail(link, 5, [allowed]), /Access denied/);
});

test('a sibling folder with the same name prefix is not inside the allow-list', async () => {
  const sibling = path.join(tmp, 'allowed-evil');
  await mkdir(sibling);
  await writeFile(path.join(sibling, 'x.log'), 'secret\n');
  await assert.rejects(readLogTail(path.join(sibling, 'x.log'), 5, [allowed]), /Access denied/);
});
