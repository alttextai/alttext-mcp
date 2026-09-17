import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const client = new Client({ name: "metadata-test", version: "1.0.0" });
const execFileAsync = promisify(execFile);
let tools: Tool[];
beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"]);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: { ALTTEXT_API_KEY: "test-placeholder-no-live-calls" },
      stderr: "pipe",
    }),
  );
  tools = (await client.listTools()).tools;
});
afterAll(async () => {
  await client.close();
});

describe("tool discovery effects", () => {
  it("preserves all tools and identifies reads without calling the API", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "bulk_create",
      "delete_image",
      "generate_alt_text",
      "generate_alt_text_from_file",
      "get_account",
      "get_image",
      "list_images",
      "scrape_page",
      "search_images",
      "translate_image",
      "update_account",
      "update_image",
    ]);
    const reads = ["get_account", "get_image", "list_images", "search_images"];
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(reads.includes(tool.name));
      expect(tool.annotations?.openWorldHint).toBe(true);
      if (reads.includes(tool.name)) {
        expect(tool.annotations?.destructiveHint).toBe(false);
        expect(tool.annotations?.idempotentHint).toBe(true);
      }
    }
  });
  it("warns about generation credits and overwrites", () => {
    for (const name of ["generate_alt_text", "generate_alt_text_from_file"]) {
      const tool = tools.find((item) => item.name === name);
      expect(tool?.annotations?.destructiveHint).toBe(true);
      expect(tool?.annotations?.idempotentHint).toBe(false);
      expect(tool?.description).toMatch(/credits/);
      expect(tool?.description).toMatch(/conversion/);
    }
    expect(tools.find((tool) => tool.name === "bulk_create")?.description).toMatch(/asynchronous/);
  });
});

describe("registry metadata", () => {
  it("declares every supported environment variable", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../server.json", import.meta.url), "utf8"),
    ) as {
      packages: Array<{
        environmentVariables: Array<{
          name: string;
          isRequired: boolean;
          isSecret: boolean;
        }>;
      }>;
    };

    expect(manifest.packages[0]?.environmentVariables).toEqual([
      expect.objectContaining({ name: "ALTTEXT_API_KEY", isRequired: true, isSecret: true }),
      expect.objectContaining({
        name: "ALTTEXT_API_BASE_URL",
        isRequired: false,
        isSecret: false,
      }),
    ]);
  });
});
