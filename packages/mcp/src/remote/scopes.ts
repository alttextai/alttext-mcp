import type { Permission } from "@alttext_ai/core";

export const SCOPES = ["openid", "mcp:read", "mcp:write", "mcp:keys"];

export const MCP_SCOPES = SCOPES.filter((scope) => scope !== "openid");

export const REQUIRED_SCOPES: Record<Permission, string[]> = {
  read: [],
  write: ["mcp:write"],
  keys_read: ["mcp:keys"],
  keys_write: ["mcp:keys", "mcp:write"],
};

/** always includes mcp:read, in the order clients list scopes */
export function toolScopes(permission: Permission): string[] {
  const needed = REQUIRED_SCOPES[permission];
  return SCOPES.filter((scope) => scope === "mcp:read" || needed.includes(scope));
}
