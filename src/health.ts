// site_health: one GET request with a hard timeout; reports status, latency and a short body preview.

export const DEFAULT_HEALTH_URL = 'https://ofai.ro/health';
export const FALLBACK_URL = 'https://ofai.ro';
const TIMEOUT_MS = 5_000;
const PREVIEW_CHARS = 300;

export interface HealthReport {
  url: string;
  status: number;
  statusText: string;
  latencyMs: number;
  bodyPreview: string;
  note?: string;
}

async function probe(url: string): Promise<HealthReport> {
  const started = performance.now();
  try {
    // The timeout signal also covers reading the body, so a slow stream cannot hang the tool.
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'mcp-demo/1.0 (site_health)' },
    });
    const latencyMs = Math.round(performance.now() - started); // time until status + headers arrived
    const body = await response.text();
    return {
      url: response.url || url,
      status: response.status,
      statusText: response.statusText,
      latencyMs,
      bodyPreview: body.slice(0, PREVIEW_CHARS),
    };
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === 'TimeoutError') throw new Error(`Timeout: ${url} did not respond within ${TIMEOUT_MS} ms.`);
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
    throw new Error(`Request to ${url} failed: ${error instanceof Error ? error.message : String(error)}${cause}`);
  }
}

export async function checkSiteHealth(url?: string): Promise<HealthReport> {
  if (url) return probe(url);
  const primary = await probe(DEFAULT_HEALTH_URL);
  if (primary.status !== 404) return primary;
  const fallback = await probe(FALLBACK_URL);
  return { ...fallback, note: `${DEFAULT_HEALTH_URL} returned 404, fell back to ${FALLBACK_URL}.` };
}

export function formatHealthReport(report: HealthReport): string {
  return [
    `URL: ${report.url}`,
    `Status: ${report.status} ${report.statusText}`.trimEnd(),
    `Latency: ${report.latencyMs} ms`,
    ...(report.note ? [`Note: ${report.note}`] : []),
    `Body (first ${PREVIEW_CHARS} chars):`,
    report.bodyPreview || '(empty)',
  ].join('\n');
}
