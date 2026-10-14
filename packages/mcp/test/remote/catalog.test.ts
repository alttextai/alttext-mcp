import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCatalog } from "../../src/remote/catalog.js";

const reads = ["get_account", "get_image", "list_images", "search_images"];
const keyReads = ["list_api_keys", "get_api_key", "list_api_key_history"];
const keyWrites = [
  "reveal_api_key_token",
  "create_api_key",
  "update_api_key",
  "rotate_api_key",
  "revoke_api_key",
];

function expectedScopes(name: string): string[] {
  if (reads.includes(name)) return ["mcp:read"];
  if (keyReads.includes(name)) return ["mcp:read", "mcp:keys"];
  if (keyWrites.includes(name)) return ["mcp:read", "mcp:write", "mcp:keys"];
  return ["mcp:read", "mcp:write"];
}

describe("hosted tool catalog", () => {
  it("declares the OAuth scopes ChatGPT must request for each tool", async () => {
    const catalog = createCatalog("https://alttext.example");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await catalog.create("key").connect(serverTransport);
    const client = new Client({ name: "catalog-test", version: "1" });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    await client.close();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("generate_alt_text");
    expect(names).not.toContain("generate_alt_text_from_file");
    expect(names).toEqual(expect.arrayContaining([...keyReads, ...keyWrites]));
    for (const tool of tools) {
      expect(tool._meta?.["securitySchemes"], tool.name).toEqual([
        { type: "oauth2", scopes: expectedScopes(tool.name) },
      ]);
    }
  });
});
