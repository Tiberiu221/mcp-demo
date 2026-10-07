// read_log_tail: returns the last N lines of a file, but only inside an allow-list of directories.

import { open, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_LINES = 200;
// Only the end of the file is read, so a multi-GB log never gets loaded into memory.
const MAX_TAIL_BYTES = 256 * 1024;

export const DEFAULT_ALLOWED_ROOTS: readonly string[] = [path.join(os.homedir(), 'Desktop'), '/var/log'];

// path.relative instead of startsWith, so "/Users/x/Desktop-evil" is not treated as inside "/Users/x/Desktop".
export function isInside(child: string, root: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function expandHome(input: string): string {
  return input === '~' || input.startsWith('~/') ? path.join(os.homedir(), input.slice(1)) : input;
}

// On macOS /var is a symlink to /private/var, so every root is kept in both spellings.
async function bothSpellings(roots: readonly string[]): Promise<string[]> {
  const real = await Promise.all(roots.map((root) => realpath(root).catch(() => path.resolve(root))));
  return [...new Set([...roots.map((root) => path.resolve(root)), ...real])];
}

export async function resolveAllowedPath(input: string, allowedRoots: readonly string[] = DEFAULT_ALLOWED_ROOTS): Promise<string> {
  const roots = await bothSpellings(allowedRoots);
  const requested = path.resolve(expandHome(input));
  const denied = (resolved?: string) =>
    new Error(
      `Access denied: "${input}"${resolved && resolved !== requested ? ` (resolves to ${resolved})` : ''} is outside the allowed directories: ${allowedRoots.join(', ')}.`,
    );

  let real: string;
  try {
    // realpath follows symlinks, so a link inside an allowed folder cannot point at ~/.ssh.
    real = await realpath(requested);
  } catch {
    // Missing files outside the allow-list get the same answer as existing ones: nothing leaks about what exists there.
    if (!roots.some((root) => isInside(requested, root))) throw denied();
    throw new Error(`File not found: ${requested}`);
  }
  if (!roots.some((root) => isInside(real, root))) throw denied(real);
  return real;
}

export interface LogTail {
  path: string;
  lines: string[];
}

export async function readLogTail(
  input: string,
  lines = 50,
  allowedRoots: readonly string[] = DEFAULT_ALLOWED_ROOTS,
): Promise<LogTail> {
  if (!Number.isInteger(lines) || lines < 1 || lines > MAX_LINES) {
    throw new Error(`lines must be an integer between 1 and ${MAX_LINES}.`);
  }
  const file = await resolveAllowedPath(input, allowedRoots);
  const info = await stat(file);
  // Checked before open(): opening a FIFO or a device could block forever.
  if (!info.isFile()) throw new Error(`Not a regular file: ${file}`);

  const length = Math.min(info.size, MAX_TAIL_BYTES);
  const start = info.size - length;
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(length), 0, length, start);
    const all = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
    if (start > 0) all.shift(); // the first line of the window is probably cut in half
    if (all.at(-1) === '') all.pop(); // trailing newline at the end of the file
    return { path: file, lines: all.slice(-lines) };
  } finally {
    await handle.close();
  }
}
