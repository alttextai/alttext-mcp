import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, type Mock } from "vitest";
import type { Io, Keychain } from "../src/io.js";

export interface FakeKeychain extends Keychain {
  value: string | null;
}

export function fakeKeychain(value: string | null = null): FakeKeychain {
  return {
    value,
    get() {
      return this.value;
    },
    set(token: string) {
      this.value = token;
    },
    remove() {
      const had = this.value !== null;
      this.value = null;
      return had;
    },
  };
}

export interface TestIo extends Io {
  out: () => string;
  err: () => string;
  prompts: { question: string; hidden: boolean }[];
}

export function testIo(
  options: {
    env?: Record<string, string | undefined>;
    tty?: boolean;
    stdin?: string;
    answers?: string[];
    keychain?: Keychain | null;
    stdoutTTY?: boolean;
  } = {},
): TestIo {
  let out = "";
  let err = "";
  const prompts: { question: string; hidden: boolean }[] = [];
  const answers = [...(options.answers ?? [])];
  const configHome = mkdtempSync(join(tmpdir(), "alttext-cli-test-"));
  return {
    env: { XDG_CONFIG_HOME: configHome, ...options.env },
    homedir: configHome,
    stdout: {
      isTTY: options.stdoutTTY ?? false,
      write(chunk: string) {
        out += chunk;
        return true;
      },
    },
    stderr: {
      isTTY: false,
      write(chunk: string) {
        err += chunk;
        return true;
      },
    },
    stdinIsTTY: options.tty ?? false,
    readStdin: () => Promise.resolve(options.stdin ?? ""),
    prompt(question, { hidden }) {
      prompts.push({ question, hidden });
      return Promise.resolve(answers.shift() ?? "");
    },
    loadKeychain: () => Promise.resolve(options.keychain === undefined ? null : options.keychain),
    out: () => out,
    err: () => err,
    prompts,
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export type Route = (url: URL, init: RequestInit) => Response;

/** Stubs fetch with routes keyed by "METHOD /path" under /api/v1. */
export function mockApi(routes: Record<string, Route | Response>): Mock {
  const fetchMock = vi.fn((input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const route = routes[`${init.method ?? "GET"} ${path}`];
    if (route === undefined) {
      return Promise.resolve(json({ error: `No route ${init.method ?? "GET"} ${path}` }, 404));
    }
    return Promise.resolve(route instanceof Response ? route.clone() : route(url, init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function requests(fetchMock: Mock): { method: string; path: string; url: URL }[] {
  return fetchMock.mock.calls.map((call) => {
    const [input, init] = call as [string, RequestInit | undefined];
    const url = new URL(input);
    return { method: init?.method ?? "GET", path: url.pathname.replace(/^\/api\/v1/, ""), url };
  });
}

export function headersOf(fetchMock: Mock, index: number): Record<string, string> {
  const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

export function keyRow(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

export const ACCOUNT = {
  name: "NextNet",
  usage: 10,
  usage_limit: 1000,
  default_lang: "en",
  whitelabel: false,
  no_quotes: false,
  api_key: { kind: "full_access", can_manage_keys: true, name: "Ops", origin: "dashboard" },
};
