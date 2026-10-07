// Stdio smoke test: spawns the built server and speaks raw JSON-RPC to it, the same way Claude Code does.
// Usage: npm run build && node scripts/smoke.mjs   (or simply: npm run smoke)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// stderr is inherited: the server's own log line shows up here, proving it never writes logs to stdout.
const server = spawn(process.execPath, ['dist/index.js'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });

let finished = false;
const fail = (reason) => {
  console.error(`SMOKE FAIL: ${reason}`);
  server.kill();
  process.exit(1);
};
server.on('exit', (code) => finished || fail(`server exited early (code ${code})`));
const timer = setTimeout(() => fail('no answer within 10 s'), 10_000);

// Every stdout line is one JSON-RPC message; responses are matched to requests by id.
const pending = new Map();
createInterface({ input: server.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  } else {
    console.log('<- (unexpected)', line);
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params && { params }) })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}

console.log('-> initialize');
const init = await request('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'smoke-test', version: '1.0.0' },
});
console.log('<-', JSON.stringify(init.result ?? init.error));

console.log('-> notifications/initialized (notification: no id, no response)');
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

console.log('-> tools/list');
const list = await request('tools/list');
const tools = list.result?.tools ?? [];
console.log(`<- ${tools.length} tools:`);
for (const tool of tools) {
  const required = new Set(tool.inputSchema.required ?? []);
  const args = Object.keys(tool.inputSchema.properties ?? {}).map((name) => (required.has(name) ? name : `${name}?`));
  console.log(`   - ${tool.name}(${args.join(', ')}): ${tool.description}`);
}

const args = { expression: '0 2 * * *' };
console.log(`-> tools/call cron_explain ${JSON.stringify(args)}`);
const call = await request('tools/call', { name: 'cron_explain', arguments: args });
console.log('<-', JSON.stringify(call.result ?? call.error));

finished = true;
clearTimeout(timer);
server.stdin.end(); // closing stdin is how a stdio client shuts the server down

const ok =
  init.result?.serverInfo?.name === 'ofai-ops-demo' &&
  ['site_health', 'read_log_tail', 'cron_explain'].every((name) => tools.some((tool) => tool.name === name)) &&
  call.result?.isError !== true &&
  call.result?.content?.[0]?.text === 'în fiecare zi la 02:00';
console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL: unexpected response');
process.exitCode = ok ? 0 : 1;
