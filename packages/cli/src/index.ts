#!/usr/bin/env node
import { run } from "./commands/program.js";
import { processIo } from "./io.js";

process.exitCode = await run(process.argv.slice(2), processIo());
