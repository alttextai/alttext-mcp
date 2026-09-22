import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { RedisClientType } from "redis";
import type { Adapter, AdapterPayload } from "oidc-provider";

export class OAuthStore {
  constructor(
    readonly redis: RedisClientType,
    readonly namespace: string,
    private readonly key: Buffer,
  ) {}

  private encrypt(value: unknown, identity: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(identity));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  private decrypt(value: string, identity: string): AdapterPayload {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(identity));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
    ) as AdapterPayload;
  }

  adapter(model: string): Adapter {
    const key = (id: string): string => `${this.namespace}:${model}:${id}`;
    const index = (name: string, id: string): string =>
      `${this.namespace}:index:${model}:${name}:${id}`;
    const grant = (id: string): string => `${this.namespace}:grant:${id}`;
    const find = async (id: string): Promise<AdapterPayload | undefined> => {
      const record = await this.redis.hGetAll(key(id));
      if (!record["payload"]) return undefined;
      const value = this.decrypt(record["payload"], key(id));
      if (model === "Client") {
        const scopes = typeof value.scope === "string" ? value.scope.split(" ") : [];
        value.scope = [...new Set(["openid", "mcp:read", "mcp:write", ...scopes])].join(" ");
      }
      if (record["consumed"]) value.consumed = Number(record["consumed"]);
      return value;
    };
    return {
      upsert: async (id, payload, expiresIn) => {
        const ttl = expiresIn === undefined ? undefined : Math.max(1, Math.ceil(expiresIn));
        const previous = await find(id);
        const tx = this.redis.multi().hSet(key(id), "payload", this.encrypt(payload, key(id)));
        if (ttl !== undefined) tx.expire(key(id), ttl);
        for (const field of ["uid", "userCode"] as const) {
          const value = payload[field];
          const oldValue = previous?.[field];
          if (typeof oldValue === "string" && oldValue !== value) tx.del(index(field, oldValue));
          if (typeof value === "string") {
            if (ttl === undefined) tx.set(index(field, value), id);
            else tx.set(index(field, value), id, { EX: ttl });
          }
        }
        if (typeof payload.grantId === "string") {
          tx.sAdd(grant(payload.grantId), key(id));
          // Grant references outlive all tokens so revocation cannot miss a surviving refresh token.
          tx.expire(grant(payload.grantId), 91 * 86400);
        }
        await tx.exec();
      },
      find,
      findByUid: async (uid) => {
        const id = await this.redis.get(index("uid", uid));
        return id ? find(id) : undefined;
      },
      findByUserCode: async (code) => {
        const id = await this.redis.get(index("userCode", code));
        return id ? find(id) : undefined;
      },
      consume: async (id) => {
        const result = await this.redis.eval(
          "if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end; return redis.call('HSETNX', KEYS[1], 'consumed', ARGV[1])",
          {
            keys: [key(id)],
            arguments: [String(Math.floor(Date.now() / 1000))],
          },
        );
        if (result !== 1) throw new Error("Authorization artifact already consumed");
      },
      destroy: async (id) => {
        const payload = await find(id);
        const tx = this.redis.multi().del(key(id));
        for (const field of ["uid", "userCode"] as const) {
          const value = payload?.[field];
          if (typeof value === "string") tx.del(index(field, value));
        }
        await tx.exec();
      },
      revokeByGrantId: async (id) => {
        await this.redis.eval(
          "local keys = redis.call('SMEMBERS', KEYS[1]); for _, key in ipairs(keys) do redis.call('DEL', key) end; redis.call('DEL', KEYS[1]); return 1",
          { keys: [grant(id)], arguments: [] },
        );
      },
    };
  }

  async put(
    name: string,
    id: string,
    value: Record<string, unknown>,
    seconds: number,
  ): Promise<void> {
    await this.adapter(name).upsert(id, value as AdapterPayload, seconds);
  }
  async get<T>(name: string, id: string): Promise<T | undefined> {
    return (await this.adapter(name).find(id)) as T | undefined;
  }
}
