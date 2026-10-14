export interface RemoteConfig {
  issuer: string;
  resource: string;
  productOrigin: string;
  handoffSecret: string;
  bridgeSecret: string;
  encryptionKey: Buffer;
  cookieKeys: string[];
  jwks: { keys: Record<string, unknown>[] };
  redisUrl: string;
  namespace: string;
  origins: Set<string>;
  port: number;
  testing: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): RemoteConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const testing = env["NODE_ENV"] === "test";
  const origin = (name: string): string => {
    const value = required(name);
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(testing && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    ) {
      throw new Error(`Invalid ${name}: exact HTTPS origin required`);
    }
    return value;
  };
  const secret = (name: string): string => {
    const value = required(name);
    if (Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`);
    return value;
  };
  const issuer = origin("MCP_ISSUER");
  const handoffSecret = secret("MCP_HANDOFF_SECRET");
  const bridgeSecret = secret("MCP_BRIDGE_SECRET");
  if (handoffSecret === bridgeSecret) throw new Error("Bridge and handoff secrets must differ");
  const encryptionKey = Buffer.from(required("MCP_ENCRYPTION_KEY"), "base64");
  if (encryptionKey.length !== 32)
    throw new Error("MCP_ENCRYPTION_KEY must be a base64 32-byte key");
  const jwks = JSON.parse(required("MCP_JWKS")) as RemoteConfig["jwks"];
  if (!Array.isArray(jwks.keys) || !jwks.keys.length)
    throw new Error("MCP_JWKS must contain private signing keys");
  const namespace = required("MCP_REDIS_NAMESPACE");
  if (!/^[a-z0-9-]{3,64}$/.test(namespace)) throw new Error("Invalid MCP_REDIS_NAMESPACE");
  const port = Number(env["PORT"] ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  return {
    issuer,
    resource: `${issuer}/mcp`,
    productOrigin: origin("MCP_PRODUCT_ORIGIN"),
    handoffSecret,
    bridgeSecret,
    encryptionKey,
    jwks,
    namespace,
    port,
    testing,
    cookieKeys: [secret("MCP_COOKIE_SECRET")],
    redisUrl: required("MCP_REDIS_URL"),
    origins: new Set([issuer, ...(env["MCP_ALLOWED_ORIGINS"] ?? "").split(",").filter(Boolean)]),
  };
}
