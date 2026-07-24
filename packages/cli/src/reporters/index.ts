import type { CommandOutput, Reporter } from "./types";
import { testSummaryToJUnit } from "./junit";

export type { CommandOutput, Reporter, ExecRequestView } from "./types";
export { testSummaryToJUnit } from "./junit";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

export class JsonReporter implements Reporter {
  write(out: CommandOutput): string {
    return JSON.stringify(out, null, 2);
  }
}

export class JunitReporter implements Reporter {
  write(out: CommandOutput): string {
    if (out.kind === "execution" && out.tests) return testSummaryToJUnit(out.tests, "run");
    if (out.kind === "suite") return testSummaryToJUnit(out.tests, out.label);
    // Non-test outputs: emit an empty suite so junit consumers get valid XML.
    return testSummaryToJUnit({ passed: 0, failed: 0, errored: 0, duration: 0, groups: [], console: [] }, out.kind);
  }
}

export class PrettyReporter implements Reporter {
  constructor(private color: boolean) {}
  private c(code: string, s: string): string {
    return this.color ? `${code}${s}${RESET}` : s;
  }
  write(out: CommandOutput): string {
    switch (out.kind) {
      case "message":
        return out.text;
      case "table":
        return this.table(out.columns, out.rows);
      case "entity":
        return Object.entries(out.entity)
          .map(([k, v]) => `${this.c(DIM, k + ":")} ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join("\n");
      case "execution":
        return this.execution(out.request.method, out.request.url, out.response, out.error, out.tests);
      case "suite": {
        const lines = out.items.map((it) =>
          this.execution(it.name, it.name, it.response, it.error, null)
        );
        lines.push(this.testsLine(out.tests));
        return lines.join("\n");
      }
    }
  }
  private table(columns: string[], rows: string[][]): string {
    const widths = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => (r[i] ?? "").length)));
    const fmt = (cells: string[]) => cells.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  ");
    return [this.c(DIM, fmt(columns)), ...rows.map(fmt)].join("\n");
  }
  private execution(
    method: string,
    url: string,
    response: { status: number; statusText: string; time: number } | null,
    error: string | null,
    tests: import("@portiq/core").TestSummary | null
  ): string {
    const head = `${method} ${url}`;
    if (error) return `${head}\n${this.c(RED, "ERROR")} ${error}`;
    const status = response
      ? `${this.c(response.status >= 400 ? RED : GREEN, String(response.status))} ${response.statusText} ${this.c(DIM, `(${response.time}ms)`)}`
      : this.c(DIM, "(not sent)");
    const parts = [`${head}\n${status}`];
    if (tests) parts.push(this.testsLine(tests));
    return parts.join("\n");
  }
  private testsLine(tests: import("@portiq/core").TestSummary): string {
    const failed = tests.failed + tests.errored;
    const label = `tests: ${tests.passed} passed, ${tests.failed} failed, ${tests.errored} errored`;
    return this.c(failed > 0 ? RED : GREEN, label);
  }
}

export function selectReporter(opts: {
  reporter?: "pretty" | "json" | "junit";
  isTTY: boolean;
  color: boolean;
}): Reporter {
  const kind = opts.reporter ?? (opts.isTTY ? "pretty" : "json");
  if (kind === "json") return new JsonReporter();
  if (kind === "junit") return new JunitReporter();
  return new PrettyReporter(opts.color);
}
