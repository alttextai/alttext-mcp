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
