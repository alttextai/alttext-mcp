import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readConfig } from "../../src/remote/config.js";
import { OAuthStore } from "../../src/remote/store.js";
import { ProductBridge } from "../../src/remote/product-bridge.js";
import { createOAuth } from "../../src/remote/oauth.js";
import { createHttp } from "../../src/remote/http.js";

function required(value: string | null | undefined): string {
  if (!value) throw new Error("Missing response field");
  return value;
}
interface TokenReply {
  access_token: string;
  id_token?: string;
  refresh_token: string;
}
let redisProcess: ChildProcess;
let redis: RedisClientType;
let store: OAuthStore;
let server: ReturnType<typeof createHttp>;
let product: ReturnType<typeof createServer>;
let issuer: string;
let active = true;
const connections = new Map<string, string[]>();
const cookies = new Map<string, { value: string; path: string }>();
const assistantCallback = "https://assistant.example/callback";
const chatGptCallback = "https://chatgpt.com/connector_platform_oauth_redirect";
async function port() {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const a = s.address();
  if (!a || typeof a === "string") throw new Error("No port");
  await new Promise<void>((resolve) =>
    s.close(() => {
      resolve();
    }),
  );
  return a.port;
}
async function browser(url: string) {
  const path = new URL(url).pathname;
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      Cookie: [...cookies]
        .filter(([, v]) => path.startsWith(v.path))
        .map(([k, v]) => `${k}=${v.value}`)
        .join("; "),
    },
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";");
    const [name, ...value] = required(pair).split("=");
    cookies.set(required(name), {
      value: value.join("="),
      path:
        attributes
          .find((a) => a.trim().toLowerCase().startsWith("path="))
          ?.trim()
          .slice(5) ?? "/",
    });
  }
  return response;
}
beforeAll(async () => {
  const redisPort = await port();
  const nodePort = await port();
  const productPort = await port();
  redisProcess = spawn(
    "redis-server",
    ["--port", String(redisPort), "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  redis = createClient({ url: `redis://127.0.0.1:${redisPort}` });
  redis.on("error", () => {});
  await redis.connect();
  issuer = `http://127.0.0.1:${nodePort}`;
  const config = readConfig({
    NODE_ENV: "test",
    MCP_ISSUER: issuer,
    MCP_PRODUCT_ORIGIN: `http://127.0.0.1:${productPort}`,
    MCP_HANDOFF_SECRET: "h".repeat(32),
    MCP_BRIDGE_SECRET: "b".repeat(32),
    MCP_COOKIE_SECRET: "c".repeat(32),
    MCP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MCP_REDIS_NAMESPACE: "integration",
    MCP_REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    MCP_JWKS: JSON.stringify({
      keys: [
        {
          ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
            format: "jwk",
          }),
          use: "sig",
          alg: "ES256",
          kid: "test",
        },
      ],
    }),
  });
  product = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${"b".repeat(32)}`) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const id =
        req.method === "POST"
          ? (JSON.parse(body) as { code: string }).code
          : ((req.url ?? "").split("/").at(-1) ?? "");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          active,
          connection_id: id,
          account_id: `account-${id}`,
          user_id: `user-${id}`,
          scopes: connections.get(id) ?? [],
          expires_at: new Date(Date.now() + 86400_000).toISOString(),
          ...(req.method === "POST" ? { api_key: `upstream-key-${id}` } : {}),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => product.listen(productPort, "127.0.0.1", resolve));
  store = new OAuthStore(redis, config.namespace, config.encryptionKey);
  const bridge = new ProductBridge(config);
  const oauth = createOAuth(config, store, bridge);
  server = createHttp(config, store, bridge, oauth, {
    readTools: new Set(["whoami"]),
    create: (key) => {
      const s = new McpServer({ name: "test", version: "1" });
      s.registerTool("whoami", {}, () => ({ content: [{ type: "text", text: key }] }));
      return s;
    },
  });
  await new Promise<void>((resolve) => server.listen(nodePort, "127.0.0.1", resolve));
});
afterAll(async () => {
  await new Promise<void>((r) =>
    server.close(() => {
      r();
    }),
  );
  await new Promise<void>((r) =>
    product.close(() => {
      r();
    }),
  );
  await redis.quit();
  redisProcess.kill();
});

async function register(scope?: string, redirectUris = [assistantCallback]) {
  const registration = await fetch(`${issuer}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: redirectUris,
      client_name: "Example",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope,
    }),
  });
  const client = (await registration.json()) as { client_id: string; scope: string };
  expect(registration.status, JSON.stringify(client)).toBe(201);
  return client;
}
function authorizationUrl(
  clientId: string,
  scope: string,
  verifier: string,
  redirectUri = assistantCallback,
) {
  const auth = new URL(`${issuer}/authorize`);
  Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    resource: `${issuer}/mcp`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "host-state",
  }).forEach(([k, v]) => {
    auth.searchParams.set(k, v);
  });
  return auth;
}
async function authorize(
  connectionId = "grant-one",
  scopes = ["mcp:read", "mcp:write"],
  requestedScopes = scopes,
  registrationScopes: string[] | null = requestedScopes,
  beforeCallback?: (interactionId: string) => Promise<void>,
  afterRegistration?: (clientId: string) => Promise<void>,
  redirect = { registered: [assistantCallback], requested: assistantCallback },
) {
  connections.set(connectionId, scopes);
  const discovery = (await (
    await fetch(`${issuer}/.well-known/oauth-authorization-server`)
  ).json()) as { issuer: string; code_challenge_methods_supported: string[] };
  expect(discovery.issuer).toBe(issuer);
  expect(discovery.code_challenge_methods_supported).toEqual(["S256"]);
  const client = await register(registrationScopes?.join(" "), redirect.registered);
  await afterRegistration?.(client.client_id);
  const verifier = randomBytes(32).toString("base64url");
  const auth = authorizationUrl(
    client.client_id,
    requestedScopes.join(" "),
    verifier,
    redirect.requested,
  );
  const noPkce = new URL(auth);
  noPkce.searchParams.delete("code_challenge");
  const denied = await browser(noPkce.href);
  expect(denied.headers.get("location")).toContain("error=invalid_request");
  const wrongResource = new URL(auth);
  wrongResource.searchParams.set("resource", "https://other.example/mcp");
  expect((await browser(wrongResource.href)).status).toBe(400);
  const first = await browser(auth.href);
  expect(first.status).toBe(303);
  const consent = await browser(new URL(required(first.headers.get("location")), issuer).href);
  const railsUrl = new URL(required(consent.headers.get("location")));
  const handoff = JSON.parse(
    Buffer.from(
      required(required(railsUrl.searchParams.get("handoff")).split(".")[0]),
      "base64url",
    ).toString(),
  ) as { return_url: string; interaction_id: string; nonce: string };
  await beforeCallback?.(handoff.interaction_id);
  const callback = new URL(handoff.return_url);
  Object.entries({
    code: connectionId,
    interaction_id: handoff.interaction_id,
    state: handoff.nonce,
  }).forEach(([k, v]) => {
    callback.searchParams.set(k, v);
  });
  const resumed = await browser(callback.href);
  expect(resumed.status).toBe(303);
  const finished = await browser(new URL(required(resumed.headers.get("location")), issuer).href);
  expect(finished.status, await finished.clone().text()).toBe(303);
  const clientUrl = new URL(required(finished.headers.get("location")), issuer);
  expect(clientUrl.origin).toBe(new URL(redirect.requested).origin);
  expect(clientUrl.searchParams.get("state")).toBe("host-state");
  const exchange = async (fields: Record<string, string>) =>
    fetch(`${issuer}/token`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: client.client_id,
        resource: `${issuer}/mcp`,
        ...fields,
      }),
    });
  const tokenResponse = await exchange({
    grant_type: "authorization_code",
    code: required(clientUrl.searchParams.get("code")),
    redirect_uri: redirect.requested,
    code_verifier: verifier,
  });
  const token = (await tokenResponse.json()) as TokenReply;
  expect(tokenResponse.status, JSON.stringify(token)).toBe(200);
  expect(token.refresh_token).toBeTypeOf("string");
  return { token, exchange, client };
}
async function toolCall(token: string, name = "whoami") {
  return fetch(`${issuer}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });
}

describe("HTTP OAuth and MCP", () => {
  it("serves the OpenAI plugin domain-verification challenge", async () => {
    const response = await fetch(`${issuer}/.well-known/openai-apps-challenge`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("PlUuJJowjOgZmLFWv_wfh-9vnZDPkIcgxyaP-82wOqw");
  });

  it("rejects unauthenticated requests and untrusted transport headers", async () => {
    const response = await fetch(`${issuer}/mcp`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    expect(
      (await fetch(`${issuer}/mcp`, { headers: { Origin: "https://evil.example" } })).status,
    ).toBe(403);
    const hostile = await new Promise<number | undefined>((resolve) => {
      const req = request(`${issuer}/mcp`, { headers: { Host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.end();
    });
    expect(hostile).toBe(403);
    const loadBalancerHealth = await new Promise<number | undefined>((resolve) => {
      const req = request(`${issuer}/health`, { headers: { Host: "10.0.0.10:3000" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.end();
    });
    expect(loadBalancerHealth).toBe(200);
  });
  it("rejects insecure registration and metadata fetch URLs", async () => {
    for (const metadata of [
      { redirect_uris: ["http://evil.example/callback"] },
      {
        redirect_uris: ["https://assistant.example/callback"],
        jwks_uri: "http://169.254.169.254/",
      },
    ]) {
      expect(
        (
          await fetch(`${issuer}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metadata),
          })
        ).status,
      ).toBe(400);
    }
  });
  it("keeps concurrent accounts isolated and denies mutations under read scope", async () => {
    const one = await authorize("tenant-one");
    const two = await authorize("tenant-two", ["mcp:read"]);
    const replies = await Promise.all([
      toolCall(one.token.access_token),
      toolCall(two.token.access_token),
    ]);
    const text = await Promise.all(replies.map((r) => r.text()));
    expect(text[0]).toContain("upstream-key-tenant-one");
    expect(text[0]).not.toContain("upstream-key-tenant-two");
    expect(text[1]).toContain("upstream-key-tenant-two");
    expect(text[1]).not.toContain("upstream-key-tenant-one");
    expect((await toolCall(two.token.access_token, "mutate")).status).toBe(403);
  });
  it("discovers, authorizes with PKCE, rotates refresh tokens and rejects revoked access", async () => {
    const { token, exchange } = await authorize();
    const call = () => toolCall(token.access_token);
    const result = await call();
    expect(result.status, await result.clone().text()).toBe(200);
    expect(
      ((await result.json()) as { result: { content: { text: string }[] } }).result.content[0]
        ?.text,
    ).toBe("upstream-key-grant-one");
    const refreshed = await exchange({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    expect(((await refreshed.json()) as TokenReply).refresh_token).not.toBe(token.refresh_token);
    active = false;
    expect((await call()).status).toBe(401);
    active = true;
    const replay = await exchange({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    expect(replay.status).toBe(400);
  });
  it("supports OpenID discovery while granting the MCP resource scopes", async () => {
    const { token } = await authorize("openai-scan", ["mcp:read", "mcp:write"], ["openid"]);
    expect(token.id_token).toBeTypeOf("string");
    expect((await toolCall(token.access_token)).status).toBe(200);
  });
  it("adds OpenID support to the ChatGPT client registered before it was advertised", async () => {
    const scopes = ["openid", "mcp:read", "mcp:write"];
    const { token } = await authorize(
      "existing-openai-client",
      ["mcp:read", "mcp:write"],
      scopes,
      ["mcp:read"],
      undefined,
      async (clientId) => {
        expect(await redis.hDel(`${store.namespace}:Client:${clientId}`, "scopes_v")).toBe(1);
      },
      { registered: [chatGptCallback], requested: chatGptCallback },
    );
    expect(token.id_token).toBeTypeOf("string");
    expect((await toolCall(token.access_token)).status).toBe(200);
  });
  it("keeps a legacy non-OpenAI client that registered read-only at read-only", async () => {
    const client = await register("mcp:read");
    expect(await redis.hDel(`${store.namespace}:Client:${client.client_id}`, "scopes_v")).toBe(1);
    const verifier = randomBytes(32).toString("base64url");
    for (const scope of ["mcp:read mcp:write", "openid mcp:read"]) {
      const denied = await browser(authorizationUrl(client.client_id, scope, verifier).href);
      expect(denied.headers.get("location")).toContain("error=invalid_scope");
    }
  });
  it("holds a newly registered read-only client to the scopes it declared", async () => {
    const client = await register("mcp:read");
    const verifier = randomBytes(32).toString("base64url");
    for (const scope of ["mcp:read mcp:write", "openid mcp:read"]) {
      const denied = await browser(authorizationUrl(client.client_id, scope, verifier).href);
      expect(denied.headers.get("location")).toContain("error=invalid_scope");
    }
  });
  it("gives a client that registers without a scope every supported scope", async () => {
    const scopes = ["openid", "mcp:read", "mcp:write"];
    const { token, client } = await authorize(
      "scope-less-client",
      ["mcp:read", "mcp:write"],
      scopes,
      null,
    );
    expect(client.scope).toBe("openid mcp:read mcp:write");
    expect(token.id_token).toBeTypeOf("string");
    expect((await toolCall(token.access_token)).status).toBe(200);
  });
  it("caps an OpenID-only request at the MCP scopes the client registered", async () => {
    const { token } = await authorize(
      "openid-read-client",
      ["mcp:read"],
      ["openid"],
      ["openid", "mcp:read"],
      async (id) => {
        // Rails creates the connection with exactly the scopes the handoff asked for
        const handoff = await store.get<{ scopes: string[] }>("Handoff", id);
        expect(handoff?.scopes).toEqual(["mcp:read"]);
        connections.set("openid-read-client", handoff?.scopes ?? []);
      },
    );
    connections.set("openid-read-client", ["mcp:read", "mcp:write"]);
    expect((await toolCall(token.access_token)).status).toBe(200);
    expect((await toolCall(token.access_token, "mutate")).status).toBe(403);
  });
  it("lets a client registered from the resource metadata scopes request openid", async () => {
    const metadata = (await (
      await fetch(`${issuer}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as { scopes_supported: string[] };
    expect(metadata.scopes_supported).toContain("openid");
    const { token } = await authorize(
      "metadata-scoped-client",
      ["mcp:read", "mcp:write"],
      ["openid"],
      metadata.scopes_supported,
    );
    expect(token.id_token).toBeTypeOf("string");
    expect((await toolCall(token.access_token)).status).toBe(200);
  });
  it("challenges a read-only token with a scope set the client can re-authorize with", async () => {
    const metadata = (await (
      await fetch(`${issuer}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as { scopes_supported: string[] };
    const readOnly = await authorize(
      "step-up-read",
      ["mcp:read"],
      ["mcp:read"],
      metadata.scopes_supported,
    );
    const denied = await toolCall(readOnly.token.access_token, "mutate");
    expect(denied.status).toBe(403);
    const hint = /scope="([^"]+)"/.exec(denied.headers.get("www-authenticate") ?? "")?.[1];
    expect(hint?.split(" ")).toContain("openid");
    const stepUp = await authorize(
      "step-up-write",
      ["mcp:read", "mcp:write"],
      required(hint).split(" "),
      metadata.scopes_supported,
    );
    expect(stepUp.token.id_token).toBeTypeOf("string");
    expect((await toolCall(stepUp.token.access_token)).status).toBe(200);
  });
  it("never lets live scopes exceed the consented scopes on an OpenID-only token", async () => {
    const { token } = await authorize("openid-read-only", ["mcp:read"], ["openid"]);
    connections.set("openid-read-only", ["mcp:read", "mcp:write"]);
    expect((await toolCall(token.access_token)).status).toBe(200);
    expect((await toolCall(token.access_token, "mutate")).status).toBe(403);
  });
  it("completes consent for handoffs written before oidcScopes existed", async () => {
    const { token } = await authorize(
      "legacy-handoff",
      ["mcp:read", "mcp:write"],
      ["mcp:read", "mcp:write"],
      ["mcp:read", "mcp:write"],
      async (id) => {
        const handoff = await store.get<{ nonce: string; scopes: string[] }>("Handoff", id);
        if (!handoff) throw new Error("Missing handoff");
        await store.put("Handoff", id, { nonce: handoff.nonce, scopes: handoff.scopes }, 300);
      },
    );
    expect((await toolCall(token.access_token)).status).toBe(200);
  });
});
