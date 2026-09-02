export type IdFactory = (prefix: string) => string;

let fallbackCounter = 0;

/** Default id generator: `crypto.randomUUID` when available (browser + Node 19+),
 *  otherwise a monotonic time+counter fallback. Callers that need determinism
 *  (tests, the renderer's `genId`) inject their own factory instead. */
export function createIdFactory(): IdFactory {
  return (prefix: string) => {
    const g = typeof crypto !== "undefined" ? (crypto as { randomUUID?: () => string }) : undefined;
    if (g && typeof g.randomUUID === "function") return `${prefix}-${g.randomUUID()}`;
    fallbackCounter += 1;
    return `${prefix}-${Date.now()}-${fallbackCounter}`;
  };
}
