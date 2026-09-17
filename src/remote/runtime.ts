import { createClient } from "redis";
import { readConfig } from "./config.js";
import { OAuthStore } from "./store.js";
import { ProductBridge } from "./product-bridge.js";
import { createOAuth } from "./oauth.js";
import { createHttp, type Catalog } from "./http.js";

export async function startRemote(catalog: Catalog): Promise<void> {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error("Hosted MCP requires Node.js 22 or later");
  const config = readConfig();
  const redis = createClient({ url: config.redisUrl, socket: { reconnectStrategy: false } });
  redis.on("error", () => {
    process.stderr.write("OAuth persistence connection failed\n");
  });
  await redis.connect();
  const store = new OAuthStore(redis, config.namespace, config.encryptionKey);
  const bridge = new ProductBridge(config);
  const oauth = createOAuth(config, store, bridge);
  const server = createHttp(config, store, bridge, oauth, catalog);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "0.0.0.0", resolve);
  });
  const shutdown = (): void => {
    server.close(() => {
      void redis.quit().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.stderr.write("Hosted MCP service listening\n");
}
