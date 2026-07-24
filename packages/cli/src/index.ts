#!/usr/bin/env node
import { CLI_NAME, CLI_VERSION } from "./version";

// Populated task-by-task. The real entry is wired in Task 20.
if (require.main === module) {
  process.stdout.write(`${CLI_NAME} ${CLI_VERSION}\n`);
}
