// Entry point: creates the MCP server, registers three tools and speaks JSON-RPC over stdio.
// stdout is reserved for protocol messages, so anything meant for humans goes to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { explainCron } from './cron.js';
import { checkSiteHealth, DEFAULT_HEALTH_URL, FALLBACK_URL, formatHealthReport } from './health.js';
import { DEFAULT_ALLOWED_ROOTS, MAX_LINES, readLogTail } from './logTail.js';

const server = new McpServer({ name: 'ofai-ops-demo', version: '1.0.0' });

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });

// Errors thrown inside a handler are sent back to the model as `isError: true` results by the SDK,
// so the model can read the message and fix its call instead of the server crashing.

server.registerTool(
  'site_health',
  {
    title: 'Site health check',
    description: `GET a URL with a 5 s timeout and report HTTP status, latency in ms and the first 300 characters of the body. Without a url it checks ${DEFAULT_HEALTH_URL} and falls back to ${FALLBACK_URL} if that returns 404.`,
    inputSchema: {
      url: z.url({ protocol: /^https?$/ }).optional().describe('http(s) URL to check; omit to check ofai.ro'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url }) => text(formatHealthReport(await checkSiteHealth(url))),
);

server.registerTool(
  'read_log_tail',
  {
    title: 'Read the end of a log file',
    description: `Return the last N lines of a text/log file. Only files under ${DEFAULT_ALLOWED_ROOTS.join(' or ')} are allowed (symlinks are resolved first); anything else is refused.`,
    inputSchema: {
      path: z.string().min(1).describe('Absolute path, ~/ path, or path relative to the server working directory'),
      lines: z.number().int().min(1).max(MAX_LINES).default(50).describe(`How many lines to return (1-${MAX_LINES}, default 50)`),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ path, lines }) => {
    const tail = await readLogTail(path, lines);
    return text([`Last ${tail.lines.length} line(s) of ${tail.path}:`, ...tail.lines].join('\n'));
  },
);

server.registerTool(
  'cron_explain',
  {
    title: 'Explain a cron expression',
    description:
      'Explain a standard 5-field cron expression (minute hour day-of-month month day-of-week) or a macro such as @daily in plain Romanian.',
    inputSchema: {
      expression: z.string().min(1).describe('Cron expression, e.g. "0 2 * * *" or "*/15 9-17 * * 1-5"'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ expression }) => text(explainCron(expression)),
);

await server.connect(new StdioServerTransport());
console.error('ofai-ops-demo MCP server running on stdio');
