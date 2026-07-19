export interface TestEntry {
  type: "pass" | "fail" | "error" | "log" | "info";
  text: string;
  label: string;
  group?: string;
  duration?: number;
  errorType?: string;
  errorMessage?: string;
}

export interface TestHarness {
  describe(name: string, fn: () => any): Promise<void>;
  test(name: string, fn: () => any): Promise<void>;
}

const clock = (): number => Date.now();

export function createTestHarness(
  output: TestEntry[],
  label: string,
  now: () => number = clock
): TestHarness {
  let currentGroup = "Ungrouped";

  const describe = (name: string, fn: () => any): Promise<void> => {
    const prev = currentGroup;
    currentGroup = name;
    const restore = () => { currentGroup = prev; };
    const recordError = (err: any) => {
      output.push({
        type: "error",
        text: name,
        label,
        group: name,
        errorType: err?.name,
        errorMessage: err?.message ?? String(err),
      });
    };
    let result: any;
    try {
      result = fn();
    } catch (err: any) {
      recordError(err);
      restore();
      return Promise.resolve();
    }
    if (result && typeof result.then === "function") {
      return result.then(restore, (err: any) => { recordError(err); restore(); });
    }
    restore();
    return Promise.resolve();
  };

  const test = (name: string, fn: () => any): Promise<void> => {
    const group = currentGroup; // capture synchronously at call time
    const start = now();
    const pass = () => output.push({ type: "pass", text: name, label, group, duration: now() - start });
    const fail = (err: any) => output.push({
      type: "fail",
      text: name,
      label,
      group,
      duration: now() - start,
      errorType: err?.name,
      errorMessage: err?.message ?? String(err),
    });
    let result: any;
    try {
      result = fn();
    } catch (err: any) {
      fail(err);
      return Promise.resolve();
    }
    if (result && typeof result.then === "function") {
      return result.then(pass, fail);
    }
    pass();
    return Promise.resolve();
  };

  return { describe, test };
}

export interface TestGroupSummary {
  name: string;
  passed: number;
  failed: number;
  errored: number;
  duration: number;
  entries: TestEntry[];
}

export interface TestSummary {
  passed: number;
  failed: number;
  errored: number;
  duration: number;
  groups: TestGroupSummary[];
  console: TestEntry[];
}

export function summarizeTests(entries: TestEntry[]): TestSummary {
  const groups: TestGroupSummary[] = [];
  const byName = new Map<string, TestGroupSummary>();
  const console: TestEntry[] = [];
  let passed = 0, failed = 0, errored = 0, duration = 0;

  for (const e of entries) {
    if (e.type === "log" || e.type === "info") {
      console.push(e);
      continue;
    }
    const name = e.group || "Ungrouped";
    let g = byName.get(name);
    if (!g) {
      g = { name, passed: 0, failed: 0, errored: 0, duration: 0, entries: [] };
      byName.set(name, g);
      groups.push(g);
    }
    g.entries.push(e);
    if (typeof e.duration === "number") {
      g.duration += e.duration;
      duration += e.duration;
    }
    if (e.type === "pass") { g.passed++; passed++; }
    else if (e.type === "fail") { g.failed++; failed++; }
    else if (e.type === "error") { g.errored++; errored++; }
  }

  return { passed, failed, errored, duration, groups, console };
}
