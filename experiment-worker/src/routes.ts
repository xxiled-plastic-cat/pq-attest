export interface ExperimentRoute {
  chain: "bitcoin" | "ethereum";
  height: number | null;
  archive: boolean;
}

export function matchRoute(pathname: string): ExperimentRoute | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") {
    return { chain: "bitcoin", height: null, archive: false };
  }
  if (path === "/ethereum") {
    return { chain: "ethereum", height: null, archive: false };
  }
  if (path === "/ethereum/archive") {
    return { chain: "ethereum", height: null, archive: true };
  }
  const archived = /^\/ethereum\/archive\/attestations\/([0-9]+)$/.exec(path);
  if (archived?.[1]) {
    return { chain: "ethereum", height: Number(archived[1]), archive: true };
  }
  const ethereum = /^\/ethereum\/attestations\/([0-9]+)$/.exec(path);
  if (ethereum?.[1]) {
    return { chain: "ethereum", height: Number(ethereum[1]), archive: false };
  }
  const bitcoin = /^\/attestations\/([0-9]+)$/.exec(path);
  if (bitcoin?.[1]) {
    return { chain: "bitcoin", height: Number(bitcoin[1]), archive: false };
  }
  return null;
}
