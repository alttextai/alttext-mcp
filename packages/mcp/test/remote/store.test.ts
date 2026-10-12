import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createClient, type RedisClientType } from "redis";
import { randomBytes } from "node:crypto";
import { OAuthStore } from "../../src/remote/store.js";

let process: ChildProcess;
let redis: RedisClientType;
let store: OAuthStore;
beforeAll(async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve) =>
    listener.close(() => {
      resolve();
    }),
  );
  process = spawn(
    "redis-server",
    ["--port", String(address.port), "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  redis = createClient({ url: `redis://127.0.0.1:${address.port}` });
  redis.on("error", () => {});
  await redis.connect();
  store = new OAuthStore(redis, "test", randomBytes(32));
});
afterAll(async () => {
  await redis.quit();
  process.kill();
});

describe("durable OAuth adapter", () => {
  it("keeps non-expiring client records and their indexes persistent", async () => {
    const adapter = store.adapter("Client");
    await adapter.upsert("client", {
      uid: "client-uid",
      clientId: "client",
      scope: "mcp:read mcp:write",
    });
    expect(await redis.ttl("test:Client:client")).toBe(-1);
    expect(await redis.ttl("test:index:Client:uid:client-uid")).toBe(-1);
    expect(await adapter.findByUid("client-uid")).toMatchObject({
      clientId: "client",
      scope: "mcp:read mcp:write",
    });
    await adapter.destroy("client");
    expect(await adapter.findByUid("client-uid")).toBeUndefined();
  });
  it("keeps expanding a legacy ChatGPT client record after it is saved again", async () => {
    const adapter = store.adapter("Client");
    const chatGpt = {
      clientId: "legacy",
      scope: "mcp:read",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    };
    await adapter.upsert("legacy", chatGpt);
    await redis.hDel("test:Client:legacy", "scopes_v");
    await adapter.upsert("legacy", chatGpt);
    expect(await adapter.find("legacy")).toMatchObject({ scope: "openid mcp:read mcp:write" });
  });
  it("leaves other legacy clients at the scope they registered", async () => {
    const adapter = store.adapter("Client");
    for (const [id, redirect] of [
      ["legacy-other", "https://assistant.example/callback"],
      ["legacy-lookalike", "https://chatgpt.com.evil.example/callback"],
      ["legacy-http", "http://chatgpt.com/callback"],
    ] as const) {
      await adapter.upsert(id, { clientId: id, scope: "mcp:read", redirect_uris: [redirect] });
      await redis.hDel(`test:Client:${id}`, "scopes_v");
      expect(await adapter.find(id), redirect).toMatchObject({ scope: "mcp:read" });
    }
    await adapter.upsert("legacy-platform", {
      clientId: "legacy-platform",
      scope: "mcp:read",
      redirect_uris: ["https://platform.openai.com/apps-manage/oauth"],
    });
    await redis.hDel("test:Client:legacy-platform", "scopes_v");
    expect(await adapter.find("legacy-platform")).toMatchObject({
      scope: "openid mcp:read mcp:write",
    });
  });

  it("rejects ciphertext moved to a different grant record", async () => {
    const adapter = store.adapter("Connection");
    await adapter.upsert("alice", { secret: "alice-key" }, 60);
    const raw = await redis.hGetAll("test:Connection:alice");
    await redis.hSet("test:Connection:bob", raw);
    await expect(adapter.find("bob")).rejects.toThrow();
  });
  it("encrypts credentials and preserves consumed state across instances", async () => {
    const adapter = store.adapter("AuthorizationCode");
    await adapter.upsert(
      "code",
      { grantId: "grant", accountId: "connection", secret: "upstream-secret" },
      60,
    );
    expect(JSON.stringify(await redis.hGetAll("test:AuthorizationCode:code"))).not.toContain(
      "upstream-secret",
    );
    await adapter.consume("code");
    expect((await store.adapter("AuthorizationCode").find("code"))?.consumed).toBeTypeOf("number");
    await adapter.revokeByGrantId("grant");
    expect(await adapter.find("code")).toBeUndefined();
  });
});
