import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCatalog } from "../../src/remote/catalog.js";

describe("hosted tool catalog", () => {
  it("declares the OAuth scopes ChatGPT must request for each tool", async () => {
    const catalog = createCatalog("https://alttext.example", "test");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await catalog.create("key").connect(serverTransport);
    const client = new Client({ name: "catalog-test", version: "1" });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((tool) => tool.name)).toContain("generate_alt_text");
    expect(tools.map((tool) => tool.name)).not.toContain("generate_alt_text_from_file");
    const reads = ["get_account", "get_image", "list_images", "search_images"];
    for (const tool of tools) {
      const scopes = reads.includes(tool.name) ? ["mcp:read"] : ["mcp:read", "mcp:write"];
      expect(tool._meta?.["securitySchemes"], tool.name).toEqual([{ type: "oauth2", scopes }]);
    }
  });
});
