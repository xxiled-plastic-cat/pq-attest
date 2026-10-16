export interface ExperimentAttestation {
  height: number;
  blockHash: string | null;
  attestTxnId: string;
  attestedAt: string;
  paidUsdc: string;
  skipped: boolean;
}

export interface ExperimentDocument {
  id: string;
  title: string;
  status: "stopped" | "running" | "complete";
  preview: boolean;
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

export function statusCopy(document: ExperimentDocument): string {
  if (document.status === "complete") {
    return "Complete. The 24-hour window has ended.";
  }
  if (document.status === "running") {
    return "Running. Each ready Bitcoin block is attested two behind the tip.";
  }
  if (!document.window) {
    return "Stopped. The 24-hour window has not opened.";
  }
  return `Stopped. Payments are paused. The window still ends at ${formatTime(document.window.end)}.`;
}

export function timeLeft(document: ExperimentDocument, now: number): string {
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
