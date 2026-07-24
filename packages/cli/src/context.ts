export interface CliContext {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  isTTY: boolean;
  now: () => number;
}

export function defaultContext(): CliContext {
  return {
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: !!process.stdout.isTTY,
    now: () => Date.now(),
  };
}
