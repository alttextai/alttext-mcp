import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  AltTextApi,
  AltTextApiError,
  operations,
  runOperation,
  type Operation,
} from "../src/index.js";

const BASE_URL = "https://alttext.ai/api/v1";

let api: AltTextApi;
let fetchMock: Mock;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function keyRow(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const token = `atai_${String(id).padStart(4, "0")}secretsecretsecret${String(id).padStart(4, "0")}`;
  return {
    id,
    name: `Client ${String(id)}`,
    kind: "site",
    origin: "api",
    integration: null,
    status: "active",
    token,
    token_hint: token.slice(-4),
    usage_limit: 500,
    credits_used: 12,
    billable_credits: 14,
    period_start: null,
    resets_at: "2026-11-01T00:00:00Z",
    previous_period: null,
    created_by: { type: "api_key", name: "Ops" },
    created_at: "2026-10-01T00:00:00Z",
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function operation(name: string): Operation {
  const found = operations.find((item) => item.name === name);
  if (!found) throw new Error(`No operation ${name}`);
  return found;
}

function requestAt(index: number): { url: URL; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url: new URL(url), init };
}

function headersAt(index: number): Record<string, string> {
  return requestAt(index).init.headers as Record<string, string>;
}

beforeEach(() => {
  api = new AltTextApi("test-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("key operations in the registry", () => {
  it("defines the eight key operations with their permissions and command nouns", () => {
    const expected: Record<string, [string, string]> = {
      list_api_keys: ["keys_read", "list"],
      get_api_key: ["keys_read", "get"],
      reveal_api_key_token: ["keys_write", "reveal"],
      create_api_key: ["keys_write", "create"],
      update_api_key: ["keys_write", "update"],
      rotate_api_key: ["keys_write", "rotate"],
      revoke_api_key: ["keys_write", "revoke"],
      list_api_key_history: ["keys_read", "history"],
    };
    for (const [name, [permission, verb]] of Object.entries(expected)) {
      const op = operation(name);
      expect(op.permission).toBe(permission);
      expect(op.command).toEqual({ noun: "keys", verb });
    }
  });

  it("marks reveal as not read-only so clients confirm before a token enters a transcript", () => {
    expect(operation("reveal_api_key_token").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(operation("rotate_api_key").annotations.destructiveHint).toBe(true);
    expect(operation("revoke_api_key").annotations.destructiveHint).toBe(true);
    expect(operation("revoke_api_key").annotations.idempotentHint).toBe(true);
  });
});

describe("list_api_keys", () => {
  it("never returns a token for 30 keys, in text or structured output", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => keyRow(i + 1));
    fetchMock.mockResolvedValueOnce(json({ api_keys: rows, next_cursor: "abc", has_more: true }));

    const result = await runOperation(operation("list_api_keys"), api, {});

    expect(result.text).not.toContain("atai_");
    expect(JSON.stringify(result.structured)).not.toContain("atai_");
    expect(result.text).toContain("…0030");
    expect((result.structured as { api_keys: unknown[] }).api_keys).toHaveLength(30);
    expect(result.structured).toMatchObject({ next_cursor: "abc", has_more: true });
  });

  it("passes the cursor, limit, status and search through", async () => {
    fetchMock.mockResolvedValueOnce(json({ api_keys: [], next_cursor: null, has_more: false }));

    await runOperation(operation("list_api_keys"), api, {
      after: "cur",
      limit: 10,
      status: "revoked",
      q: "acme",
    });

    const { url } = requestAt(0);
    expect(url.pathname).toBe("/api/v1/api_keys");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      after: "cur",
      limit: "10",
      status: "revoked",
      q: "acme",
    });
  });
});

describe("get_api_key", () => {
  it("preserves incomplete current and historical billing flags without leaking tokens", async () => {
    const period = {
      billable_credits: 140,
      billable_complete: false,
      period_start: "2026-09-01T00:00:00Z",
      period_end: "2026-10-01T00:00:00Z",
      starts_on: "2026-09-01",
      ends_on: "2026-10-01",
      credits: 100,
    };
    fetchMock.mockResolvedValueOnce(
      json(
        keyRow(7, {
          billable_complete: false,
          usage: { credit_history: [period] },
        }),
      ),
    );
    const result = await runOperation(operation("get_api_key"), api, { id: 7, detail: "full" });
    expect(result.structured).toMatchObject({
      billable_complete: false,
      usage: { credit_history: [period] },
    });
    expect(result.text).toContain("incomplete");
    expect(JSON.stringify(result.structured)).not.toContain("atai_");
  });

  it("returns the key without its token", async () => {
    fetchMock.mockResolvedValueOnce(json(keyRow(7)));

    const result = await runOperation(operation("get_api_key"), api, { id: 7, detail: "full" });

    expect(requestAt(0).url.href).toBe(`${BASE_URL}/api_keys/7?detail=full`);
    expect(result.text).not.toContain("atai_");
    expect(JSON.stringify(result.structured)).not.toContain("atai_");
    expect(result.structured).toMatchObject({ id: 7, token_hint: "0007" });
  });
});

describe("reveal_api_key_token", () => {
  it("returns exactly one key's token through the audited reveal read", async () => {
    fetchMock.mockResolvedValueOnce(json(keyRow(7)));

    const result = await runOperation(operation("reveal_api_key_token"), api, { id: 7 });

    expect(requestAt(0).url.href).toBe(`${BASE_URL}/api_keys/7?reveal=true`);
    const token = keyRow(7)["token"] as string;
    expect(result.structured).toMatchObject({ id: 7, token });
    expect(result.text.match(/atai_/g)).toHaveLength(1);
  });
});

describe("create_api_key", () => {
  it("returns the new token and sends the idempotency key as a header", async () => {
    fetchMock.mockResolvedValueOnce(json(keyRow(9), 201));

    const result = await runOperation(operation("create_api_key"), api, {
      name: "Acme",
      usage_limit: 500,
      idempotency_key: "retry-1",
    });

    const { url, init } = requestAt(0);
    expect(url.pathname).toBe("/api/v1/api_keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme", usage_limit: 500 });
    expect(headersAt(0)["Idempotency-Key"]).toBe("retry-1");
    expect(result.structured).toMatchObject({ id: 9, token: keyRow(9)["token"] });
  });

  it("creates one key when retried with the same idempotency key", async () => {
    const issued = new Map<string, Record<string, unknown>>();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const header = (init.headers as Record<string, string>)["Idempotency-Key"] ?? "";
      const row = issued.get(header) ?? keyRow(issued.size + 1);
      issued.set(header, row);
      return Promise.resolve(json(row, 201));
    });

    const input = { name: "Acme", idempotency_key: "same-key" };
    const first = await runOperation(operation("create_api_key"), api, input);
    const second = await runOperation(operation("create_api_key"), api, input);

    expect(headersAt(0)["Idempotency-Key"]).toBe("same-key");
    expect(headersAt(1)["Idempotency-Key"]).toBe("same-key");
    expect(issued.size).toBe(1);
    expect(second.structured).toEqual(first.structured);
  });

  it("sends no idempotency header when none is given", async () => {
    fetchMock.mockResolvedValueOnce(json(keyRow(9), 201));
    await runOperation(operation("create_api_key"), api, { name: "Acme" });
    expect(headersAt(0)).not.toHaveProperty("Idempotency-Key");
  });
});

describe("key name length", () => {
  it.each(["create_api_key", "update_api_key"])(
    "%s accepts the server's 128 characters, no more",
    (name) => {
      const input = operation(name).input;
      expect(input.safeParse({ id: 1, name: "a".repeat(128) }).success).toBe(true);
      expect(input.safeParse({ id: 1, name: "a".repeat(129) }).success).toBe(false);
    },
  );
});

describe("idempotency keys", () => {
  it("are offered only where the server honors them, on create and rotate", () => {
    const offering = operations
      .filter((item) => "idempotency_key" in item.input.shape)
      .map((item) => item.name);
    expect(offering).toEqual(["create_api_key", "rotate_api_key"]);
  });
});

describe("update_api_key", () => {
  it("sends a null usage limit to make the key unlimited and returns no token", async () => {
    fetchMock.mockResolvedValueOnce(json(keyRow(3, { usage_limit: null })));

    const result = await runOperation(operation("update_api_key"), api, {
      id: 3,
      usage_limit: null,
    });

    const { url, init } = requestAt(0);
    expect(url.pathname).toBe("/api/v1/api_keys/3");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ usage_limit: null });
    expect(headersAt(0)).not.toHaveProperty("Idempotency-Key");
    expect(result.text).not.toContain("atai_");
    expect(JSON.stringify(result.structured)).not.toContain("atai_");
    expect(result.text).toContain("Unlimited");
  });
});

describe("rotate_api_key and revoke_api_key", () => {
  const warning =
    "This key belongs to your Shopify integration, which stops working until it reconnects with a new key.";

  it("rotation returns the new token and surfaces the integration warning", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...keyRow(4), integration_warning: warning }));

    const result = await runOperation(operation("rotate_api_key"), api, {
      id: 4,
      idempotency_key: "rot-1",
    });

    const { url, init } = requestAt(0);
    expect(url.pathname).toBe("/api/v1/api_keys/4/rotation");
    expect(init.method).toBe("POST");
    expect(headersAt(0)["Idempotency-Key"]).toBe("rot-1");
    expect(result.structured).toMatchObject({
      token: keyRow(4)["token"],
      integration_warning: warning,
    });
    expect(result.text).toContain(warning);
  });

  it("revocation surfaces the integration warning", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        ...keyRow(4, { status: "revoked", token: null, token_hint: null }),
        integration_warning: warning,
      }),
    );

    const result = await runOperation(operation("revoke_api_key"), api, { id: 4 });

    const { url, init } = requestAt(0);
    expect(url.pathname).toBe("/api/v1/api_keys/4/revocation");
    expect(init.method).toBe("POST");
    expect(headersAt(0)).not.toHaveProperty("Idempotency-Key");
    expect(result.structured).toMatchObject({ status: "revoked", integration_warning: warning });
    expect(result.text).toContain(warning);
  });
});

describe("list_api_key_history", () => {
  it("reads a key's events with a cursor", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        events: [
          {
            id: 1,
            action: "updated",
            actor: { type: "api_key", name: "Ops" },
            before: { limit: 100 },
            after: { limit: 500 },
            created_at: "2026-10-02T00:00:00Z",
          },
        ],
        next_cursor: null,
        has_more: false,
      }),
    );

    const result = await runOperation(operation("list_api_key_history"), api, {
      id: 4,
      after: "c1",
      limit: 5,
    });

    expect(requestAt(0).url.href).toBe(`${BASE_URL}/api_keys/4/history?after=c1&limit=5`);
    expect(result.text).toContain("updated");
    expect(result.structured).toMatchObject({ events: [{ action: "updated" }], has_more: false });
  });
});

describe("API refusals", () => {
  it("keeps the error code and required scope", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: "This connection has not been granted the Manage API keys permission.",
          error_code: "insufficient_scope",
          required_scope: "mcp:keys",
        },
        403,
      ),
    );

    const error = await runOperation(operation("list_api_keys"), api, {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AltTextApiError);
    expect(error).toMatchObject({
      status: 403,
      errorCode: "insufficient_scope",
      requiredScope: "mcp:keys",
    });
  });

  it("keeps Retry-After on a rate limit", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "Too many API key requests", error_code: "rate_limited" }, 429, {
        "Retry-After": "60",
      }),
    );

    const error = await runOperation(operation("create_api_key"), api, { name: "x" }).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({ status: 429, errorCode: "rate_limited", retryAfter: 60 });
  });
});

describe("get_account key context", () => {
  it("includes the calling key's kind and whether it can manage keys", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        name: "Acme",
        usage: 1,
        usage_limit: 10,
        api_key: { kind: "full_access", can_manage_keys: true, name: "Ops", origin: "dashboard" },
      }),
    );

    const result = await runOperation(operation("get_account"), api, {});

    expect(result.structured).toMatchObject({ key_kind: "full_access", can_manage_keys: true });
    expect(result.text).toContain("Key kind: full_access");
    expect(result.text).toContain("Can manage keys: yes");
  });
});
