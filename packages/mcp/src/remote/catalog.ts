import { AltTextApi, operations, VERSION } from "@alttext_ai/core";
import { createServer } from "../server.js";
import type { Catalog } from "./http.js";

/** Hosted tools: every connection sees the key tools, and http.ts gates each call on scope. */
export function createCatalog(productOrigin: string): Catalog {
  return {
    permissions: new Map(operations.map((operation) => [operation.name, operation.permission])),
    create: (key) =>
      createServer(new AltTextApi(key, `${productOrigin}/api/v1`, VERSION), {
        localFiles: false,
        keys: true,
      }),
  };
}
