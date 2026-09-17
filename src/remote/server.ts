import { createRequire } from "node:module";
import { AltTextApi } from "../alttext-api.js";
import { createServer } from "../server.js";
import { readConfig } from "./config.js";
import { startRemote } from "./runtime.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };
const config = readConfig();
await startRemote({
  readTools: new Set(["get_account", "list_images", "search_images", "get_image"]),
  create: (key) =>
    createServer(new AltTextApi(key, `${config.productOrigin}/api/v1`, version), {
      localFiles: false,
    }),
});
