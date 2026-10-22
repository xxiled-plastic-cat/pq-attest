export interface ExperimentAttestation {
  height: number;
  blockHash: string | null;
  attestTxnId: string;
  attestedAt: string;
  paidUsdc: string;
  skipped: boolean;
  elapsedMs?: number | null;
}

export interface ExperimentDocument {
  id: string;
  title: string;
  chain?: "bitcoin" | "ethereum";
  mode?: "window" | "test";
  status: "stopped" | "running" | "complete";
  preview: boolean;
  test?: { paid: number; cap: number } | null;
  window: { start: string; end: string } | null;
  stats: {
    attested: number;
    failures: number;
    usdcSpent: string;
    tip: number | null;
    nextHeight: number | null;
    lag: number;
    lastError: string | null;
  };
  attestations: ExperimentAttestation[];
}

export function experimentApis(apiBase: string, fallbackApi?: string): string[] {
  const primary = resolveApi(apiBase);
  if (primary !== apiBase || !fallbackApi || fallbackApi === primary) {
    return [primary];
  }
  return [primary, fallbackApi];
}

export async function fetchExperiment(apiBases: string[]): Promise<ExperimentDocument> {
  let lastError: Error | null = null;
  for (const apiBase of apiBases) {
    try {
      return await fetchExperimentFrom(apiBase);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("The experiment status could not be loaded.");
    }
  }
  throw lastError ?? new Error("The experiment status could not be loaded.");
}

async function fetchExperimentFrom(apiBase: string): Promise<ExperimentDocument> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/`, { headers: { accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new Error("The experiment status could not be loaded.");
  }
  if (!response.ok) {
    throw new Error("The experiment status could not be loaded.");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The experiment status could not be loaded.");
  }
  if (!isDocument(body)) {
    throw new Error("The experiment status could not be loaded.");
  }
  return body;
}

/** Display spend as attested blocks times the 0.001 USDC price. */
export function attestedUsdcSpent(attested: number): string {
  if (!Number.isSafeInteger(attested) || attested <= 0) {
    return "0";
  }
  const whole = Math.floor(attested / 1000);
  const fraction = String(attested % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : String(whole);
}

export function statusLabel(status: ExperimentDocument["status"]): string {
  if (status === "running") return "Running";
  if (status === "complete") return "Complete";
  return "Stopped";
}

export function chainLabel(chain: ExperimentDocument["chain"]): string {
  return chain === "ethereum" ? "Ethereum" : "Bitcoin";
}

export function blockExplorerUrl(chain: ExperimentDocument["chain"], hash: string): string {
  if (chain === "ethereum") {
    return `https://etherscan.io/block/${hash}`;
  }
  return `https://mempool.space/block/${hash}`;
}

export function blockExplorerName(chain: ExperimentDocument["chain"]): string {
  return chain === "ethereum" ? "Etherscan" : "mempool.space";
}

export function formatLatency(elapsedMs: number | null | undefined): string {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "—";
  }
  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)} ms`;
  }
  return `${(elapsedMs / 1000).toFixed(1)} s`;
}

export function paidProgress(document: ExperimentDocument): string {
  const paid = document.test?.paid ?? document.stats.attested;
  const cap = document.test?.cap ?? 30;
  return `${paid} of ${cap} paid`;
}

export function statusCopy(document: ExperimentDocument): string {
  if (document.mode === "test") {
    if (document.status === "complete") {
      return "Complete. The 30-block paid test has finished.";
    }
    if (document.status === "running") {
      return `Running. Paying for 30 ${chainLabel(document.chain)} blocks, ten at a time, each two behind the tip.`;
    }
    if ((document.test?.paid ?? document.stats.attested) === 0) {
      return "Stopped. The 30-block paid test has not opened.";
    }
    return "Stopped. Payments are paused. The 30-block paid test has not finished.";
  }
  const hours = document.chain === "ethereum" ? "6-hour" : "24-hour";
  const chain = chainLabel(document.chain);
  if (document.status === "complete") {
    return `Complete. The ${hours} window has ended.`;
  }
  if (document.status === "running") {
    return `Running. Each ready ${chain} block is attested two behind the tip.`;
  }
  if (!document.window) {
    return `Stopped. The ${hours} window has not opened.`;
  }
  return `Stopped. Payments are paused. The window still ends at ${formatTime(document.window.end)}.`;
}

export function timeLeft(document: ExperimentDocument, now: number): string {
  if (document.mode === "test") {
    if (document.status === "complete") {
      return "Ended";
    }
    const cap = document.test?.cap ?? 30;
    const paid = document.test?.paid ?? 0;
    if (document.status === "stopped" && paid === 0) {
      return "Not started";
    }
    const left = cap - paid;
    return left > 0 ? `${left} blocks left` : "Ended";
  }
  if (!document.window) {
    return "Not started";
  }
  if (document.status === "complete") {
    return "Ended";
  }
  const remaining = Date.parse(document.window.end) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return "Ended";
  }
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export const ATTESTATION_PAGE_SIZE = 20;

export interface AttestationPage {
  rows: ExperimentAttestation[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
}

/** Newest attestation first. A later block height breaks a tied timestamp. */
export function attestationsLatestFirst(rows: ExperimentAttestation[]): ExperimentAttestation[] {
  return rows.slice().sort((left, right) => {
    const leftTime = Date.parse(left.attestedAt);
    const rightTime = Date.parse(right.attestedAt);
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);
    if (leftValid && rightValid && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    if (leftValid !== rightValid) {
      return leftValid ? -1 : 1;
    }
    return right.height - left.height;
  });
}

export function attestationPage(
  rows: ExperimentAttestation[],
  page: number,
  pageSize = ATTESTATION_PAGE_SIZE,
): AttestationPage {
  const sorted = attestationsLatestFirst(rows);
  const total = sorted.length;
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : ATTESTATION_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, requested), pageCount);
  const start = (current - 1) * size;
  const slice = sorted.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

export function shorten(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function resolveApi(apiBase: string): string {
  if (typeof window === "undefined") {
    return apiBase;
  }
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    return apiBase;
  }
  const override = new URLSearchParams(window.location.search).get("api");
  if (!override) {
    return apiBase;
  }
  try {
    const url = new URL(override);
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return url.origin;
    }
  } catch {
    return apiBase;
  }
  return apiBase;
}

function isDocument(value: unknown): value is ExperimentDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<ExperimentDocument>;
  return (
    (record.status === "stopped" || record.status === "running" || record.status === "complete") &&
    typeof record.preview === "boolean" &&
    !!record.stats &&
    typeof record.stats.attested === "number" &&
    Array.isArray(record.attestations)
  );
}
