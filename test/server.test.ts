import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AltTextApi } from "../src/alttext-api.js";
import { createServer } from "../src/server.js";

describe("server registration", () => {
  it("preserves local tools and excludes machine files from hosted discovery", async () => {
    for (const localFiles of [true, false]) {
      const server = createServer(new AltTextApi("test-key"), { localFiles });
      const client = new Client({ name: "test", version: "1" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      await client.connect(b);
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      expect(tools).toHaveLength(localFiles ? 12 : 10);
      expect(tools.includes("generate_alt_text_from_file")).toBe(localFiles);
      expect(tools.includes("bulk_create")).toBe(localFiles);
      await client.close();
      await server.close();
    }
  });
});
