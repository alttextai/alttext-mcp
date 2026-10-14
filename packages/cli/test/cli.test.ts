import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { operations, VERSION } from "@alttext_ai/core";
import { buildProgram, run } from "../src/commands/program.js";
import { credentialsPath, resolveCredential, storeCredential } from "../src/credentials.js";
import {
  ACCOUNT,
  fakeKeychain,
  headersOf,
  json,
  keyRow,
  mockApi,
  requests,
  testIo,
} from "./helpers.js";

const ENV_KEY = { ALTTEXT_API_KEY: "atai_envkey" };

vi.mock("node:fs/promises", { spy: true });

function outputSchema(name: string) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw new Error(`No operation ${name}`);
  return operation.output;
}

function writeCredentialsFile(configHome: string, apiKey: string): void {
  mkdirSync(join(configHome, "alttext"), { recursive: true });
  writeFileSync(join(configHome, "alttext", "credentials"), JSON.stringify({ api_key: apiKey }), {
    mode: 0o600,
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("login", () => {
  it("exits 3 for a revoked key, says so, and stores nothing", async () => {
    const keychain = fakeKeychain();
    const io = testIo({ stdin: "atai_revoked\n", keychain });
    mockApi({
      "GET /account": json({ error: "API key revoked", error_code: "api_key_revoked" }, 401),
    });

    expect(await run(["login"], io)).toBe(3);
    expect(io.err()).toMatch(/this key was revoked/i);
    expect(keychain.value).toBeNull();
    expect(existsSync(credentialsPath(io.env, io.homedir))).toBe(false);
  });

  it("verifies through GET /account before storing in the keychain", async () => {
    const keychain = fakeKeychain();
    const io = testIo({ stdin: "atai_good\n", keychain });
    const fetchMock = mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["login"], io)).toBe(0);
    expect(requests(fetchMock).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /account"]);
    expect(headersOf(fetchMock, 0)["X-API-Key"]).toBe("atai_good");
    expect(headersOf(fetchMock, 0)["X-Client"]).toBe(`alttext-cli/${VERSION}`);
    expect(keychain.value).toBe("atai_good");
    expect(io.out()).toContain("NextNet");
  });

  it("reads from a hidden prompt on a terminal", async () => {
    const keychain = fakeKeychain();
    const io = testIo({ tty: true, answers: ["atai_typed"], keychain });
    mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["login"], io)).toBe(0);
    expect(io.prompts).toEqual([{ question: expect.any(String) as unknown, hidden: true }]);
    expect(keychain.value).toBe("atai_typed");
  });

  it("refuses to prompt with --no-input on a terminal", async () => {
    const io = testIo({ tty: true, keychain: fakeKeychain() });
    const fetchMock = mockApi({});

    expect(await run(["login", "--no-input"], io)).toBe(2);
    expect(io.prompts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a 0600 credentials file when the keychain is unavailable", async () => {
    const io = testIo({ stdin: "atai_good", keychain: null });
    mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["login"], io)).toBe(0);
    const path = join(io.env["XDG_CONFIG_HOME"] ?? "", "alttext", "credentials");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toContain("atai_good");
  });

  it("falls back to the file when the keychain fails to store", async () => {
    const keychain = fakeKeychain();
    keychain.set = () => {
      throw new Error("no secret service");
    };
    const io = testIo({ stdin: "atai_good", keychain });
    mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["login"], io)).toBe(0);
    expect(statSync(credentialsPath(io.env, io.homedir)).mode & 0o777).toBe(0o600);
  });

  it("keeps the previous file credential when a replacement write is interrupted", async () => {
    const io = testIo();
    await storeCredential(io, "atai_previous");
    const path = credentialsPath(io.env, io.homedir);
    const original = readFileSync(path, "utf8");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(writeFile).mockImplementationOnce(async (file, _contents, options) => {
      await actual.writeFile(file, "", options);
      throw new Error("disk full during write");
    });

    await expect(storeCredential(io, "atai_replacement")).rejects.toThrow("disk full");
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(await resolveCredential(io)).toEqual({ apiKey: "atai_previous", source: "file" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(path))).toEqual(["credentials"]);
  });

  it("keeps the latest fallback login active when the old keychain becomes readable", async () => {
    const keychain = fakeKeychain("atai_previous_account");
    keychain.set = () => {
      throw new Error("locked");
    };
    const io = testIo({ stdin: "atai_new_account", keychain });
    const fetchMock = mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["login"], io)).toBe(0);
    expect(await run(["whoami", "--json"], io)).toBe(0);
    expect(headersOf(fetchMock, 1)["X-API-Key"]).toBe("atai_new_account");

    keychain.set = (token) => {
      keychain.value = token;
    };
    expect(await run(["login"], io)).toBe(0);
    expect(existsSync(credentialsPath(io.env, io.homedir))).toBe(false);
    expect(await run(["whoami", "--json"], io)).toBe(0);
    expect(headersOf(fetchMock, 3)["X-API-Key"]).toBe("atai_new_account");
  });

  it("defaults the credentials file to ~/.config without XDG_CONFIG_HOME", () => {
    expect(credentialsPath({}, "/home/ana")).toBe("/home/ana/.config/alttext/credentials");
  });

  it("accepts no key flag", async () => {
    const io = testIo({ keychain: fakeKeychain() });
    expect(await run(["login", "--api-key", "atai_x"], io)).toBe(2);
  });
});

describe("logout", () => {
  it("reports a keychain initialization failure even when fallback cleanup succeeds", async () => {
    const keychain = fakeKeychain("atai_previous");
    const io = testIo({ keychain });
    writeCredentialsFile(io.env["XDG_CONFIG_HOME"] ?? "", "atai_file");
    io.loadKeychain = () => Promise.reject(new Error("backend temporarily unavailable"));
    expect(await run(["logout"], io)).toBe(1);
    expect(io.err()).toMatch(/keychain.*logout/i);
    expect(existsSync(credentialsPath(io.env, io.homedir))).toBe(false);
    io.loadKeychain = () => Promise.resolve(keychain);
    expect(await resolveCredential(io)).toEqual({ apiKey: "atai_previous", source: "keychain" });
    expect(await run(["logout"], io)).toBe(0);
    expect(await resolveCredential(io)).toBeNull();
  });

  it("removes the keychain entry and the credentials file", async () => {
    const keychain = fakeKeychain("atai_stored");
    const io = testIo({ keychain });
    writeCredentialsFile(io.env["XDG_CONFIG_HOME"] ?? "", "atai_file");

    expect(await run(["logout"], io)).toBe(0);
    expect(keychain.value).toBeNull();
    expect(existsSync(credentialsPath(io.env, io.homedir))).toBe(false);
  });

  it("reports failed keychain removal instead of successful logout", async () => {
    const keychain = fakeKeychain("atai_stored");
    keychain.remove = () => {
      throw new Error("locked");
    };
    const io = testIo({ keychain });
    writeCredentialsFile(io.env["XDG_CONFIG_HOME"] ?? "", "atai_file");

    expect(await run(["logout"], io)).toBe(1);
    expect(io.out()).not.toContain("Logged out");
    expect(io.err()).toMatch(/keychain.*logout/i);
    expect(existsSync(credentialsPath(io.env, io.homedir))).toBe(false);
  });
});

describe("credentials and whoami", () => {
  it("lets ALTTEXT_API_KEY override the stored key and says so", async () => {
    const io = testIo({ env: ENV_KEY, keychain: fakeKeychain("atai_stored") });
    const fetchMock = mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["whoami"], io)).toBe(0);
    expect(headersOf(fetchMock, 0)["X-API-Key"]).toBe("atai_envkey");
    expect(io.out()).toMatch(/ALTTEXT_API_KEY/);
  });

  it("prints the account, key kind, key management and credential source", async () => {
    const io = testIo({ keychain: fakeKeychain("atai_stored") });
    mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["whoami"], io)).toBe(0);
    expect(io.out()).toContain("NextNet");
    expect(io.out()).toContain("full_access");
    expect(io.out()).toMatch(/manage keys: yes/i);
    expect(io.out()).toMatch(/keychain/i);
  });

  it("uses the keychain before the file", async () => {
    const io = testIo({ keychain: fakeKeychain("atai_keychain") });
    writeCredentialsFile(io.env["XDG_CONFIG_HOME"] ?? "", "atai_file");
    const fetchMock = mockApi({ "GET /account": json(ACCOUNT) });

    await run(["whoami", "--json"], io);
    expect(headersOf(fetchMock, 0)["X-API-Key"]).toBe("atai_keychain");
    expect(JSON.parse(io.out())).toMatchObject({ credential_source: "keychain" });
  });

  it.each([
    ["unavailable", null],
    ["empty", fakeKeychain()],
  ])("uses the file when the keychain is %s", async (_label, keychain) => {
    const io = testIo({ keychain });
    writeCredentialsFile(io.env["XDG_CONFIG_HOME"] ?? "", "atai_file");
    const fetchMock = mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["whoami", "--json"], io)).toBe(0);
    expect(headersOf(fetchMock, 0)["X-API-Key"]).toBe("atai_file");
    expect(JSON.parse(io.out())).toEqual({
      account: "NextNet",
      key_name: "Ops",
      key_kind: "full_access",
      can_manage_keys: true,
      credential_source: "file",
    });
  });

  it("uses the file when reading the keychain throws", async () => {
    const keychain = fakeKeychain();
    keychain.get = () => {
      throw new Error("locked");
    };
    const io = testIo({ keychain });
    writeCredentialsFile(io.env["XDG_CONFIG_HOME"] ?? "", "atai_file");
    const fetchMock = mockApi({ "GET /account": json(ACCOUNT) });

    expect(await run(["whoami"], io)).toBe(0);
    expect(headersOf(fetchMock, 0)["X-API-Key"]).toBe("atai_file");
  });

  it("exits 3 and points at login with no credential", async () => {
    const io = testIo({ keychain: fakeKeychain() });
    const fetchMock = mockApi({});

    expect(await run(["keys", "list"], io)).toBe(3);
    expect(io.err()).toContain("alttext login");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["corrupt", '{"api_key": "atai_'],
    ["null", "null"],
    ["an array", '["atai_x"]'],
  ])("treats a credentials file that is %s as no stored key", async (_label, contents) => {
    const io = testIo({ keychain: fakeKeychain() });
    const path = credentialsPath(io.env, io.homedir);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents, { mode: 0o600 });
    const fetchMock = mockApi({});

    expect(await run(["whoami"], io)).toBe(3);
    expect(io.err()).toContain("alttext login");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors ALTTEXT_API_BASE_URL", async () => {
    const io = testIo({
      env: { ...ENV_KEY, ALTTEXT_API_BASE_URL: "http://localhost:3000/api/v1" },
    });
    const fetchMock = mockApi({ "GET /account": json(ACCOUNT) });

    await run(["whoami"], io);
    expect(requests(fetchMock)[0]?.url.origin).toBe("http://localhost:3000");
  });
});

describe("keys list", () => {
  const page = { api_keys: [keyRow(1), keyRow(2)], next_cursor: null, has_more: false };

  it("prints a table with token hints only", async () => {
    const io = testIo({ env: ENV_KEY });
    mockApi({ "GET /api_keys": json(page) });

    expect(await run(["keys", "list"], io)).toBe(0);
    const [header] = io.out().split("\n");
    for (const column of ["NAME", "STATUS", "TOKEN", "BILLABLE", "LIMIT", "RESETS"]) {
      expect(header).toContain(column);
    }
    expect(io.out()).toContain("Client 1");
    expect(io.out()).toContain("…0001");
    expect(io.out()).not.toContain("atai_");
  });

  it("prints full tokens with --show-tokens", async () => {
    const io = testIo({ env: ENV_KEY });
    mockApi({ "GET /api_keys": json(page) });

    expect(await run(["keys", "list", "--show-tokens"], io)).toBe(0);
    expect(io.out()).toContain(keyRow(1)["token"] as string);
    expect(io.out()).toContain(keyRow(2)["token"] as string);
  });

  it("passes --status, --q and --limit through", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "GET /api_keys": json(page) });

    await run(["keys", "list", "--status", "all", "--q", "Acme", "--limit", "5"], io);
    const params = requests(fetchMock)[0]?.url.searchParams;
    expect(params?.get("status")).toBe("all");
    expect(params?.get("q")).toBe("Acme");
    expect(params?.get("limit")).toBe("5");
  });

  it("notes on stderr when more keys exist", async () => {
    const io = testIo({ env: ENV_KEY });
    mockApi({ "GET /api_keys": json({ ...page, next_cursor: "c2", has_more: true }) });

    expect(await run(["keys", "list"], io)).toBe(0);
    expect(io.err()).toMatch(/more/i);
    expect(io.err()).toContain("--all");
    expect(io.out()).not.toMatch(/more/i);
  });

  it("follows cursors to the end with --all and prints each key once", async () => {
    const io = testIo({ env: ENV_KEY });
    const pages: Record<string, unknown> = {
      "": { api_keys: [keyRow(1), keyRow(2)], next_cursor: "c2", has_more: true },
      c2: { api_keys: [keyRow(3), keyRow(4)], next_cursor: "c3", has_more: true },
      c3: { api_keys: [keyRow(5)], next_cursor: null, has_more: false },
    };
    const fetchMock = mockApi({
      "GET /api_keys": (url) => json(pages[url.searchParams.get("after") ?? ""]),
    });

    expect(await run(["keys", "list", "--all"], io)).toBe(0);
    expect(requests(fetchMock).map((r) => r.url.searchParams.get("after"))).toEqual([
      null,
      "c2",
      "c3",
    ]);
    for (const id of [1, 2, 3, 4, 5]) {
      expect(io.out().split(`Client ${String(id)} `).length - 1).toBe(1);
    }
    expect(io.err()).not.toMatch(/more/i);
  });

  it("prints JSON on stdout that matches the operation's output schema", async () => {
    const io = testIo({ env: ENV_KEY });
    mockApi({ "GET /api_keys": json(page) });

    expect(await run(["keys", "list", "--json"], io)).toBe(0);
    const parsed = JSON.parse(io.out()) as unknown;
    expect(outputSchema("list_api_keys").parse(parsed)).toEqual(parsed);
    expect(io.out()).not.toContain("atai_");
  });

  it("colors only on a terminal and not under NO_COLOR", async () => {
    mockApi({ "GET /api_keys": json(page) });
    const plain = testIo({ env: ENV_KEY });
    const tty = testIo({ env: ENV_KEY, stdoutTTY: true });
    const noColor = testIo({ env: { ...ENV_KEY, NO_COLOR: "1" }, stdoutTTY: true });

    await run(["keys", "list"], plain);
    await run(["keys", "list"], tty);
    await run(["keys", "list"], noColor);
    expect(plain.out()).not.toContain("\u001b[");
    expect(tty.out()).toContain("\u001b[");
    expect(noColor.out()).not.toContain("\u001b[");
  });
});

describe("keys get", () => {
  it("prints labeled fields with a hint, or the full token with --show-tokens", async () => {
    mockApi({ "GET /api_keys/7": json(keyRow(7)) });
    const masked = testIo({ env: ENV_KEY });
    const full = testIo({ env: ENV_KEY });

    expect(await run(["keys", "get", "7"], masked)).toBe(0);
    expect(await run(["keys", "get", "7", "--show-tokens"], full)).toBe(0);
    expect(masked.out()).toMatch(/Status: active/);
    expect(masked.out()).toContain("…0007");
    expect(masked.out()).not.toContain("atai_");
    expect(full.out()).toContain(`Status: active\nToken: ${keyRow(7)["token"] as string}\n`);
  });
});

describe("token-issuing commands", () => {
  it("create prints the token alone on stdout and the idempotency key on stderr", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "POST /api_keys": json(keyRow(9, { name: "Acme" }), 201) });

    expect(await run(["keys", "create", "--name", "Acme", "--usage-limit", "500"], io)).toBe(0);
    expect(io.out()).toBe(`${keyRow(9)["token"] as string}\n`);
    const idempotencyKey = headersOf(fetchMock, 0)["Idempotency-Key"];
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(io.err()).toContain(idempotencyKey);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme", usage_limit: 500 });
  });

  it("create sends the given --idempotency-key and --usage-limit none as null", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "POST /api_keys": json(keyRow(9), 201) });

    await run(
      ["keys", "create", "--name", "Acme", "--usage-limit", "none", "--idempotency-key", "k-1"],
      io,
    );
    expect(headersOf(fetchMock, 0)["Idempotency-Key"]).toBe("k-1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme", usage_limit: null });
  });

  it("create --json carries the token in an object matching the output schema", async () => {
    const io = testIo({ env: ENV_KEY });
    mockApi({ "POST /api_keys": json(keyRow(9), 201) });

    expect(await run(["keys", "create", "--name", "Acme", "--json"], io)).toBe(0);
    const parsed = JSON.parse(io.out()) as Record<string, unknown>;
    expect(outputSchema("create_api_key").parse(parsed)).toEqual(parsed);
    expect(parsed["token"]).toBe(keyRow(9)["token"]);
  });

  it("reveal prints the token alone", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "GET /api_keys/3": json(keyRow(3)) });

    expect(await run(["keys", "reveal", "3"], io)).toBe(0);
    expect(io.out()).toBe(`${keyRow(3)["token"] as string}\n`);
    expect(requests(fetchMock)[0]?.url.searchParams.get("reveal")).toBe("true");
  });

  it("rotate --yes prints the new token alone and the integration warning on stderr", async () => {
    const io = testIo({ env: ENV_KEY });
    const rotated = keyRow(4, {
      token: "atai_newtokennewtokennew0004",
      origin: "shopify",
      integration: "shopify",
      integration_warning: "This key belongs to your Shopify integration.",
    });
    mockApi({ "POST /api_keys/4/rotation": json(rotated) });

    expect(await run(["keys", "rotate", "4", "--yes"], io)).toBe(0);
    expect(io.out()).toBe("atai_newtokennewtokennew0004\n");
    expect(io.err()).toContain("This key belongs to your Shopify integration.");
  });
});

describe("destructive commands", () => {
  it.each([
    [["keys", "revoke", "4"]],
    [["keys", "rotate", "4"]],
    [["images", "delete", "img-1"]],
    [["account", "update", "--name", "New"]],
  ])("%j with no TTY and no --yes exits 2 and sends no request", async (argv) => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({});

    expect(await run(argv, io)).toBe(2);
    expect(io.err()).toContain("--yes");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys revoke with --no-input on a terminal needs --yes", async () => {
    const io = testIo({ env: ENV_KEY, tty: true });
    const fetchMock = mockApi({});

    expect(await run(["keys", "revoke", "4", "--no-input"], io)).toBe(2);
    expect(io.prompts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys rotate --dry-run reads the target, prints it and sends no mutation", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "GET /api_keys/4": json(keyRow(4, { name: "Acme" })) });

    expect(await run(["keys", "rotate", "4", "--dry-run"], io)).toBe(0);
    expect(requests(fetchMock).map((r) => r.method)).toEqual(["GET"]);
    expect(io.out()).toContain("Acme");
    expect(io.out()).toMatch(/stops working immediately/);
    expect(io.out()).not.toContain("atai_");
  });

  it("keys revoke --dry-run --json describes the effect without a token", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "GET /api_keys/4": json(keyRow(4)) });

    expect(await run(["keys", "revoke", "4", "--dry-run", "--json"], io)).toBe(0);
    expect(requests(fetchMock).map((r) => r.method)).toEqual(["GET"]);
    expect(JSON.parse(io.out())).toMatchObject({
      dry_run: true,
      operation: "revoke_api_key",
      target: { id: 4, name: "Client 4" },
    });
    expect(io.out()).not.toContain("atai_");
  });

  it("keys create --dry-run sends nothing", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({});

    expect(await run(["keys", "create", "--name", "Acme", "--dry-run"], io)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(io.out()).toContain("Acme");
  });

  it("names Shopify in the rotate confirmation of a Shopify-origin key", async () => {
    const io = testIo({ env: ENV_KEY, tty: true, answers: ["y"] });
    const shopifyKey = keyRow(4, {
      name: "shop.myshopify.com",
      origin: "shopify",
      integration: "shopify",
    });
    const fetchMock = mockApi({
      "GET /api_keys/4": json(shopifyKey),
      "POST /api_keys/4/rotation": json({ ...shopifyKey, token: "atai_rotated000000000000004" }),
    });

    expect(await run(["keys", "rotate", "4"], io)).toBe(0);
    const shown = io.err() + io.prompts.map((p) => p.question).join("");
    expect(shown).toContain("shop.myshopify.com");
    expect(shown).toContain("Shopify");
    expect(shown).toMatch(/stops working immediately/);
    expect(requests(fetchMock).map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api_keys/4",
      "POST /api_keys/4/rotation",
    ]);
    expect(io.out()).toBe("atai_rotated000000000000004\n");
  });

  it.each([
    [["keys", "revoke", "4", "--yes"], "POST /api_keys/4/revocation"],
    [["keys", "update", "4", "--name", "Renamed"], "PATCH /api_keys/4"],
  ])("%j sends no idempotency key and prints none", async (argv, route) => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "GET /api_keys/4": json(keyRow(4)), [route]: json(keyRow(4)) });

    expect(await run(argv, io)).toBe(0);
    expect(requests(fetchMock).map((r) => `${r.method} ${r.path}`)).toContain(route);
    const sent = fetchMock.mock.calls.map((_call, index) => headersOf(fetchMock, index));
    expect(sent.filter((headers) => "Idempotency-Key" in headers)).toEqual([]);
    expect(io.err()).not.toContain("Idempotency key");
  });

  it("says revocation can't be undone and stops when declined", async () => {
    const io = testIo({ env: ENV_KEY, tty: true, answers: ["n"] });
    const fetchMock = mockApi({ "GET /api_keys/4": json(keyRow(4)) });

    expect(await run(["keys", "revoke", "4"], io)).toBe(1);
    expect(io.err() + io.prompts.map((p) => p.question).join("")).toMatch(/can't be undone/);
    expect(requests(fetchMock).map((r) => r.method)).toEqual(["GET"]);
  });
});

describe("errors and exit codes", () => {
  it.each([
    [401, "invalid_api_key", 3],
    [401, "api_key_revoked", 3],
    [403, "full_access_required", 4],
    [403, "insufficient_scope", 4],
    [404, null, 5],
    [409, "key_revoked", 6],
    [409, "idempotent_replay_superseded", 6],
    [409, "request_in_progress", 6],
    [422, "idempotency_key_reused", 6],
    [500, null, 1],
  ])("HTTP %i %s exits %i with the error on stderr", async (status, code, exit) => {
    const io = testIo({ env: ENV_KEY });
    mockApi({ "GET /api_keys/4": json({ error: "Nope", error_code: code }, status) });

    expect(await run(["keys", "get", "4"], io)).toBe(exit);
    expect(io.out()).toBe("");
    expect(io.err()).toContain("Nope");
  });

  it("exits 7 on a rate limit and prints when to retry", async () => {
    const io = testIo({ env: ENV_KEY });
    mockApi({
      "GET /api_keys": json({ error: "Slow down", error_code: "rate_limited" }, 429, {
        "retry-after": "30",
      }),
    });

    expect(await run(["keys", "list"], io)).toBe(7);
    expect(io.err()).toMatch(/30 seconds/);
  });

  it("exits 2 on a bad flag value without a request", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({});

    expect(await run(["keys", "list", "--limit", "many"], io)).toBe(2);
    expect(await run(["keys", "list", "--status", "gone"], io)).toBe(2);
    expect(await run(["keys", "frobnicate"], io)).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("other registry commands", () => {
  it("runs images, account and pages commands through the registry", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({
      "GET /images/img-1": json({ asset_id: "img-1", alt_text: "A red barn" }),
      "GET /account": json(ACCOUNT),
      "POST /images/page_scrape": json({ scraped_images: [], total_processed: 0 }),
    });

    expect(await run(["images", "get", "img-1"], io)).toBe(0);
    expect(await run(["account", "get"], io)).toBe(0);
    expect(await run(["pages", "scrape", "--url", "https://example.com"], io)).toBe(0);
    expect(io.out()).toContain("A red barn");
    expect(io.out()).toContain("NextNet");
    expect(requests(fetchMock).map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /images/img-1",
      "GET /account",
      "POST /images/page_scrape",
    ]);
  });

  it("images delete --yes deletes", async () => {
    const io = testIo({ env: ENV_KEY });
    const fetchMock = mockApi({ "DELETE /images/img-1": json({}) });

    expect(await run(["images", "delete", "img-1", "--yes"], io)).toBe(0);
    expect(requests(fetchMock).map((r) => r.method)).toEqual(["DELETE"]);
  });
});

describe("help", () => {
  const program = buildProgram(testIo());
  const paths = [
    [],
    ...program.commands.flatMap((command) => [
      [command.name()],
      ...command.commands.map((sub) => [command.name(), sub.name()]),
    ]),
  ];

  it("covers every registry command and the CLI-only ones", () => {
    const names = paths.map((path) => path.join(" "));
    for (const operation of operations) {
      expect(names).toContain(`${operation.command.noun} ${operation.command.verb}`);
    }
    for (const name of ["login", "logout", "whoami"]) expect(names).toContain(name);
  });

  it.each(paths.map((path) => [path.join(" ") || "alttext", path]))(
    "%s --help matches its snapshot",
    async (_name, path) => {
      const io = testIo();
      expect(await run([...path, "--help"], io)).toBe(0);
      expect(io.out()).toMatchSnapshot();
    },
  );
});
