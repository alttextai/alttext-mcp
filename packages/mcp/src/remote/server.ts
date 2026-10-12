import { createCatalog } from "./catalog.js";
import { readConfig } from "./config.js";
import { startRemote } from "./runtime.js";

await startRemote(createCatalog(readConfig().productOrigin));
