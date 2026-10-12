import { createRequire } from "node:module";
import { readConfig } from "./config.js";
import { createCatalog } from "./catalog.js";
import { startRemote } from "./runtime.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };
const config = readConfig();
await startRemote(createCatalog(config.productOrigin, version));
