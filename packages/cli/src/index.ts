#!/usr/bin/env node
import { VERSION } from "@alttext_ai/core";

const USAGE = `Usage: alttext [options]

Options:
  -v, --version  Print the version
  -h, --help     Print this help`;

const [arg] = process.argv.slice(2);
if (arg === "-v" || arg === "--version") {
  console.log(VERSION);
} else if (arg === undefined || arg === "-h" || arg === "--help") {
  console.log(USAGE);
} else {
  console.error(`Unknown option: ${arg}\n\n${USAGE}`);
  process.exit(1);
}
