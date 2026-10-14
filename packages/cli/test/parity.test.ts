import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AltTextApi, availableOperations, operationJsonSchemas } from "@alttext_ai/core";
import { createServer } from "../../mcp/src/server.js";
import { buildCommandTable, CLI_ONLY_COMMANDS } from "../src/commands/registry.js";

const FILE_TOOLS = ["bulk_create", "generate_alt_text_from_file"];

async function listMcpTools(localFiles: boolean): Promise<Tool[]> {
  const server = createServer(new AltTextApi("test-key"), { localFiles, keys: true });
  const client = new Client({ name: "parity", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools;
}

describe.each([true, false])("registry parity with localFiles %s", (localFiles) => {
  const operations = availableOperations({ localFiles, keys: true });
  const commands = buildCommandTable({ localFiles });
  const names = operations.map((operation) => operation.name).sort();

  it("exposes every operation on both surfaces and nothing else", async () => {
    const tools = await listMcpTools(localFiles);
    expect(tools.map((tool) => tool.name).sort()).toEqual(names);
    expect(
      commands
        .map((command) => command.operation)
        .filter((name) => !CLI_ONLY_COMMANDS.includes(name))
        .sort(),
    ).toEqual(names);
    expect(new Set(commands.map((command) => command.name)).size).toBe(commands.length);
  });

  it("matches descriptions, annotations and schemas across surfaces", async () => {
    const tools = await listMcpTools(localFiles);
    for (const operation of operations) {
      const tool = tools.find((item) => item.name === operation.name);
      const command = commands.find((item) => item.operation === operation.name);
      const schemas = operationJsonSchemas(operation);
      expect(tool?.title).toBe(operation.title);
      expect(tool?.description).toBe(operation.description);
      expect(command?.description).toBe(operation.description);
      expect(tool?.annotations).toEqual(operation.annotations);
      expect(command?.annotations).toEqual(operation.annotations);
      expect(tool?.inputSchema).toEqual(schemas.input);
      expect(command?.inputSchema).toEqual(schemas.input);
      expect(tool?.outputSchema).toEqual(schemas.output);
      expect(command?.outputSchema).toEqual(schemas.output);
      expect(command?.flags.map((flag) => flag.property)).toEqual(
        Object.keys(schemas.input["properties"] as object),
      );
    }
  });

  it("carries the local-file tools only when local files are on", async () => {
    const tools = (await listMcpTools(localFiles)).map((tool) => tool.name);
    const commandOperations = commands.map((command) => command.operation);
    for (const name of FILE_TOOLS) {
      expect(tools.includes(name)).toBe(localFiles);
      expect(commandOperations.includes(name)).toBe(localFiles);
    }
  });
});

describe("key commands", () => {
  it("puts all eight key operations in the command table under keys", () => {
    const keyCommands = buildCommandTable()
      .filter((command) => command.noun === "keys")
      .map((command) => `${command.name}=${command.operation}`)
      .sort();
    expect(keyCommands).toEqual([
      "keys create=create_api_key",
      "keys get=get_api_key",
      "keys history=list_api_key_history",
      "keys list=list_api_keys",
      "keys reveal=reveal_api_key_token",
      "keys revoke=revoke_api_key",
      "keys rotate=rotate_api_key",
      "keys update=update_api_key",
    ]);
  });
});

describe("CLI-only carve-out", () => {
  it("names commands that no registry operation claims", () => {
    expect(CLI_ONLY_COMMANDS).toEqual(["login", "logout", "whoami"]);
    const claimed = new Set(
      availableOperations({ keys: true }).flatMap((operation) => [
        operation.name,
        operation.command.noun,
      ]),
    );
    for (const name of CLI_ONLY_COMMANDS) expect(claimed.has(name)).toBe(false);
  });
});
