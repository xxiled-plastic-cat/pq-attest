export function parseBitcoinTip(text: string): number {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error("Bitcoin tip was not a height.");
  }
  const tip = Number(trimmed);
  if (!Number.isSafeInteger(tip)) {
    throw new Error("Bitcoin tip was not a height.");
  }
  return tip;
}

export async function fetchBitcoinTip(apiUrl: string, fetchImpl: typeof fetch): Promise<number> {
  const url = `${apiUrl.replace(/\/$/, "")}/blocks/tip/height`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error.";
    throw new Error(`Bitcoin tip request failed: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`Bitcoin tip request failed (${response.status}).`);
  }
  return parseBitcoinTip(await response.text());
}
