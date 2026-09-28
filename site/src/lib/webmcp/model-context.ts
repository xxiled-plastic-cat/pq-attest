import type { ModelContext, WebMcpApiSurface } from "./types";

interface DocumentWithModelContext {
  modelContext?: ModelContext;
  domain: string;
}

interface NavigatorWithModelContext {
  modelContext?: ModelContext;
}

/**
 * Current Chrome publisher API is `document.modelContext.registerTool`
 * (Chrome 150). `navigator.modelContext` is a deprecated alias still used by
 * some ChatGPT / older-preview hosts.
 */
export function getModelContext(): {
  api: Exclude<WebMcpApiSurface, "unavailable">;
  context: ModelContext;
} | null {
  const doc =
    typeof document === "undefined"
      ? undefined
      : (document as Document & DocumentWithModelContext).modelContext;
  if (doc && typeof doc.registerTool === "function") {
    return { api: "document.modelContext", context: doc };
  }

  const nav =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & NavigatorWithModelContext).modelContext;
  if (nav && typeof nav.registerTool === "function") {
    return { api: "navigator.modelContext", context: nav };
  }

  return null;
}

/**
 * WebMCP is disabled when origin isolation is relaxed via `document.domain`.
 * This page never assigns `document.domain`.
 */
export function isOriginIsolated(): boolean {
  if (typeof document === "undefined" || typeof location === "undefined") {
    return true;
  }
  const domain = (document as Document & DocumentWithModelContext).domain;
  return domain === "" || domain === location.hostname;
}
