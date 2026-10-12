import { AltTextApi } from "../alttext-api.js";
import { createServer } from "../server.js";
import type { Catalog } from "./http.js";

const READ_TOOLS = new Set(["get_account", "list_images", "search_images", "get_image"]);

export function createCatalog(productOrigin: string, version: string): Catalog {
  return {
    readTools: READ_TOOLS,
    create: (key) =>
      createServer(new AltTextApi(key, `${productOrigin}/api/v1`, version), {
        localFiles: false,
        // ChatGPT asks for the scopes a tool declares here when it links or re-links
        toolMeta: (name) => ({
          securitySchemes: [
            {
              type: "oauth2",
              scopes: READ_TOOLS.has(name) ? ["mcp:read"] : ["mcp:read", "mcp:write"],
            },
          ],
        }),
      }),
  };
}
