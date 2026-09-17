#!/usr/bin/env node
import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AltTextApi } from "./alttext-api.js";
import { createServer } from "./server.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
const apiKey = process.env["ALTTEXT_API_KEY"];
if (!apiKey) {
  console.error("ALTTEXT_API_KEY environment variable is required");
  process.exit(1);
}

const server = createServer(new AltTextApi(apiKey, process.env["ALTTEXT_API_BASE_URL"], version));
server
  .connect(new StdioServerTransport())
  .then(() => {
    console.error("AltText.ai MCP Server running on stdio");
  })
  .catch((err: unknown) => {
    console.error("Fatal error:", err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  });
