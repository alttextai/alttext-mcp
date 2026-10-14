import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AltTextApi } from "@alttext_ai/core";
import { createLocalServer } from "../src/server.js";

const KEY_TOOLS = [
  "create_api_key",
  "get_api_key",
  "list_api_key_history",
  "list_api_keys",
  "reveal_api_key_token",
  "revoke_api_key",
  "rotate_api_key",
  "update_api_key",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function account(kind: string, canManage: boolean) {
  return {
    name: "Acme",
    usage: 1,
    usage_limit: 10,
    api_key: { kind, can_manage_keys: canManage, name: "Ops", origin: "dashboard" },
  };
}

function keyRow(id: number): Record<string, unknown> {
  const token = `atai_${String(id).padStart(4, "0")}secretsecret`;
  return {
    id,
    name: `Client ${String(id)}`,
    kind: "site",
    origin: "api",
    status: "active",
    token,
    token_hint: token.slice(-4),
    usage_limit: null,
    credits_used: 0,
    billable_credits: 0,
    created_at: "2026-10-01T00:00:00Z",
  };
}

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: "keys-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return client;
}

async function startWith(respond: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => Promise.resolve(respond(new URL(url), init))),
  );
  return connect(await createLocalServer(new AltTextApi("test-key")));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local stdio key-tool visibility (AE9)", () => {
  it("lists no key tools when started with a site key", async () => {
    const client = await startWith(() => json(account("site", false)));
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools.filter((name) => KEY_TOOLS.includes(name))).toEqual([]);
    expect(tools).toContain("get_account");
    await client.close();
  });

  it("lists all eight key tools when started with a full-access key", async () => {
    const client = await startWith(() => json(account("full_access", true)));
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools.filter((name) => KEY_TOOLS.includes(name)).sort()).toEqual(KEY_TOOLS);
    await client.close();
  });

  it("fails closed and still starts when the account probe fails", async () => {
    const client = await startWith(() => json({ error: "down" }, 503));
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools.filter((name) => KEY_TOOLS.includes(name))).toEqual([]);
    expect(tools).toContain("get_account");
    await client.close();
  });
});

describe("key tools over MCP with a full-access key", () => {
  it("lists 30 keys without an atai_ token in text or structured content", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => keyRow(i + 1));
    const client = await startWith((url) =>
      url.pathname.endsWith("/account")
        ? json(account("full_access", true))
        : json({ api_keys: rows, next_cursor: null, has_more: false }),
    );

    const result = await client.callTool({ name: "list_api_keys", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).not.toContain("atai_");
    expect(JSON.stringify(result.structuredContent)).not.toContain("atai_");
    await client.close();
  });

  it("gets a key without its token and reveals exactly one through a non-read-only tool", async () => {
    const client = await startWith((url) =>
      url.pathname.endsWith("/account") ? json(account("full_access", true)) : json(keyRow(7)),
    );

    const got = await client.callTool({ name: "get_api_key", arguments: { id: 7 } });
    expect(JSON.stringify(got)).not.toContain("atai_");

    const revealed = await client.callTool({ name: "reveal_api_key_token", arguments: { id: 7 } });
    expect(JSON.stringify(revealed.structuredContent).match(/atai_/g)).toHaveLength(1);

    const tool = (await client.listTools()).tools.find((t) => t.name === "reveal_api_key_token");
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    await client.close();
  });

  it("surfaces a mid-session API refusal as a tool error with its code", async () => {
    const client = await startWith((url) =>
      url.pathname.endsWith("/account")
        ? json(account("full_access", true))
        : json(
            {
              error: "This connection has not been granted the Manage API keys permission.",
              error_code: "insufficient_scope",
              required_scope: "mcp:keys",
            },
            403,
          ),
    );

    const result = await client.callTool({
      name: "update_api_key",
      arguments: { id: 3, usage_limit: 100 },
    });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("Code: insufficient_scope");
    expect(text).toContain("Required scope: mcp:keys");
    await client.close();
  });
});
