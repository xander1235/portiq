import type { RequestResponse } from "../model";
import { createTestHarness, type TestEntry } from "./testRunner";
import type { ScriptStep } from "../model";

export interface PmContext {
  request: any;
  response: RequestResponse;
  env: Record<string, string>;
  setEnvVar(key: string, value: string): void;
  sendRequest(payload: any): Promise<any>;
  label?: string;
  group?: string;
}

export interface Pm {
  request: {
    headers: Record<string, any>;
    url: string;
    method: string;
  };
  response: {
    code: number;
    status: string;
    text(): string;
    json(): any;
    to: {
      have: {
        status(expected: any): void;
      };
    };
  };
  environment: {
    get(key: string): string | undefined;
    set(key: string, value: any): void;
    unset(key: string): void;
    toObject(): Record<string, string>;
  };
  variables: {
    get(key: string): string | undefined;
    set(key: string, value: any): void;
    unset(key: string): void;
    toObject(): Record<string, string>;
  };
  describe(name: string, fn: () => any): Promise<void>;
  test(name: string, fn: () => any): Promise<void>;
  expect(value: any): {
    to: {
      equal(expected: any): void;
      be: {
        true(): void;
        false(): void;
      };
      exist(): void;
      have: {
        property(prop: string): void;
      };
      contain(expected: any): void;
    };
  };
  sendRequest(payload: any): Promise<any>;
}

export function buildPm(ctx: PmContext, output: TestEntry[]): Pm {
  const request = ctx.request || {};
  const response = ctx.response || ({} as RequestResponse);

  const readEnvVar = (key: string) => ctx.env[key];
  const writeEnvVar = (key: string, value: any) => {
    ctx.env[key] = value;
    ctx.setEnvVar(key, value);
  };
  const unsetEnvVar = (key: string) => {
    delete ctx.env[key];
    ctx.setEnvVar(key, "");
  };
  const toEnvObject = () => ({ ...ctx.env });

  const harness = createTestHarness(output, ctx.label ?? "script", Date.now, ctx.group ?? "Ungrouped");

  const pm: Pm = {
    request: {
      headers: request.headers || {},
      url: request.url || "",
      method: request.method || ""
    },
    response: {
      code: (response as any)?.status ?? (response as any)?.code ?? 0,
      status: (response as any)?.statusText || "",
      text: () => (response as any)?.body ?? "",
      json: () => {
        if ((response as any)?.json) return (response as any).json;
        if ((response as any)?.body) {
          try {
            return JSON.parse((response as any).body);
          } catch {
            return null;
          }
        }
        return null;
      },
      to: {
        have: {
          status: (expected: any) => {
            const actual = (response as any)?.status ?? (response as any)?.code ?? 0;
            if (actual !== expected) throw new Error(`Expected status ${expected} but got ${actual}`);
          }
        }
      }
    },
    environment: {
      get: (key: string) => readEnvVar(key),
      set: (key: string, value: any) => writeEnvVar(key, value),
      unset: (key: string) => unsetEnvVar(key),
      toObject: () => toEnvObject()
    },
    variables: {
      get: (key: string) => readEnvVar(key),
      set: (key: string, value: any) => writeEnvVar(key, value),
      unset: (key: string) => unsetEnvVar(key),
      toObject: () => toEnvObject()
    },
    describe: (name: string, fn: () => any) => harness.describe(name, fn),
    test: (name: string, fn: () => any) => harness.test(name, fn),
    expect: (value: any) => ({
      to: {
        equal: (expected: any) => {
          if (value !== expected) throw new Error(`Expected ${expected} but got ${value}`);
        },
        be: {
          true: () => {
            if (value !== true) throw new Error(`Expected true but got ${value}`);
          },
          false: () => {
            if (value !== false) throw new Error(`Expected false but got ${value}`);
          }
        },
        exist: () => {
          if (value === null || value === undefined) throw new Error("Expected value to exist");
        },
        have: {
          property: (prop: string) => {
            if (value == null || !(prop in Object(value))) {
              throw new Error(`Expected property ${prop} to exist`);
            }
          }
        },
        contain: (expected: any) => {
          if (!String(value).includes(String(expected))) {
            throw new Error(`Expected ${value} to contain ${expected}`);
          }
        }
      }
    }),
    sendRequest: async (payload: any) => ctx.sendRequest(payload)
  };

  return pm;
}

export async function runScript(code: string, ctx: PmContext): Promise<TestEntry[]> {
  const output: TestEntry[] = [];
  if (!code || !code.trim()) return output;

  const pm = buildPm(ctx, output);
  const request = ctx.request || {};
  const response = ctx.response || {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction("context", "api", "pm", "output", code);
  try {
    await fn({ request, response }, undefined, pm, output);
  } catch (err: any) {
    output.push({
      type: "error",
      text: `Script Error: ${err.message}`,
      label: ctx.label ?? "script",
      group: ctx.group,
      errorType: err.name,
      errorMessage: err.message
    });
  }
  return output;
}

export async function runSteps(steps: ScriptStep[], ctx: PmContext): Promise<TestEntry[]> {
  const output: TestEntry[] = [];
  for (const step of steps || []) {
    const name = (step.name || "").trim() || "Untitled step";
    const entries = await runScript(step.script, { ...ctx, group: name });
    output.push(...entries);
  }
  return output;
}
