import { AltTextApi, VERSION } from "@alttext_ai/core";
import { createServer } from "../server.js";
import { readConfig } from "./config.js";
import { startRemote } from "./runtime.js";

const config = readConfig();
await startRemote({
  readTools: new Set(["get_account", "list_images", "search_images", "get_image"]),
  create: (key) =>
    createServer(new AltTextApi(key, `${config.productOrigin}/api/v1`, VERSION), {
      localFiles: false,
    }),
});
