#!/usr/bin/env node

import { runHiveCli } from "./composition/cli.js";

void runHiveCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`hive: ${message}\n`);
  process.exitCode = 1;
});
