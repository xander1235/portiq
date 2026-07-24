export const EXIT = { SUCCESS: 0, RUNTIME: 1, TEST: 2, USAGE: 3 } as const;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export class TestFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestFailureError";
  }
}

export function toExitCode(err: unknown): number {
  if (err instanceof UsageError) return EXIT.USAGE;
  if (err instanceof TestFailureError) return EXIT.TEST;
  if (err instanceof RuntimeError) return EXIT.RUNTIME;
  return EXIT.RUNTIME;
}
