#!/usr/bin/env node
import { defaultContext } from "./context";
import { runCli } from "./run";

runCli(defaultContext())
  .then((code) => { process.exitCode = code; })
  .catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exitCode = 1; });
