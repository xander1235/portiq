import type { HttpResult, TestSummary } from "@portiq/core";

export interface ExecRequestView {
  protocol: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type CommandOutput =
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "entity"; entity: Record<string, unknown> }
  | {
      kind: "execution";
      request: ExecRequestView;
      response: HttpResult | null;
      error: string | null;
      tests: TestSummary | null;
      steps?: unknown;
    }
  | {
      kind: "suite";
      label: string;
      items: Array<{ name: string; response: HttpResult | null; error: string | null }>;
      tests: TestSummary;
    }
  | { kind: "message"; text: string };

export interface Reporter {
  write(out: CommandOutput): string;
}
