// @portiq/core mock module — in-process HTTP mock server + route helpers.
// Plain factory module: single-implementation domain, so NO registry / no
// self-registration side-effect (Phase 0.5 Part C — no CapabilityRegistry).
import { MockServerManager } from "./mockServer";

export * from "./mockServer";
export * from "./routes";

/**
 * Factory for a fresh mock-server manager. Preferred entry point for consumers
 * (Electron main, CLI) over `new MockServerManager()`.
 */
export function createMockManager(): MockServerManager {
  return new MockServerManager();
}
