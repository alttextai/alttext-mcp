import { AltTextApi, operations, VERSION } from "@alttext_ai/core";
import { createServer } from "../server.js";
import type { Catalog } from "./http.js";
import { toolScopes } from "./scopes.js";

/** Hosted tools: every connection sees the key tools, and http.ts gates each call on scope. */
export function createCatalog(productOrigin: string): Catalog {
  // ChatGPT asks for the scopes a tool declares here when it links or re-links
  const toolMeta = new Map(
    operations.map((operation) => [
      operation.name,
      { securitySchemes: [{ type: "oauth2", scopes: toolScopes(operation.permission) }] },
    ]),
  );
  return {
    permissions: new Map(operations.map((operation) => [operation.name, operation.permission])),
    create: (key) =>
      createServer(new AltTextApi(key, `${productOrigin}/api/v1`, VERSION), {
        localFiles: false,
        keys: true,
        toolMeta: (operation) => toolMeta.get(operation.name),
      }),
  };
}
