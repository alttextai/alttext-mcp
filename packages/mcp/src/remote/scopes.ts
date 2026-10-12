import type { Permission } from "@alttext_ai/core";

export const SCOPES = ["openid", "mcp:read", "mcp:write", "mcp:keys"];

export const REQUIRED_SCOPES: Record<Permission, string[]> = {
  read: [],
  write: ["mcp:write"],
  keys_read: ["mcp:keys"],
  keys_write: ["mcp:keys", "mcp:write"],
};

/** The MCP scopes a tool with this permission needs, in the order clients list them. */
export function toolScopes(permission: Permission): string[] {
  const needed = REQUIRED_SCOPES[permission];
  return SCOPES.filter((scope) => scope === "mcp:read" || needed.includes(scope));
}
