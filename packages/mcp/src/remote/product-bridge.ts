import { createHmac } from "node:crypto";
import type { RemoteConfig } from "./config.js";

export interface Connection {
  active?: boolean;
  connection_id: string;
  user_id: string;
  account_id: string;
  scopes: string[];
  expires_at: string;
  api_key?: string;
}

export function signHandoff(claims: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export class ProductBridge {
  constructor(private readonly config: RemoteConfig) {}

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.config.productOrigin}/api/internal/mcp/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${this.config.bridgeSecret}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Product authorization unavailable (${response.status})`);
    return response.status === 204 ? undefined : response.json();
  }

  async redeem(code: string, interactionId: string, nonce: string): Promise<Connection> {
    const result = (await this.request("handoffs", "POST", {
      code,
      interaction_id: interactionId,
      nonce,
    })) as Connection;
    if (!this.valid(result) || typeof result.api_key !== "string" || !result.api_key)
      throw new Error("Invalid product grant");
    return result;
  }

  async status(id: string): Promise<Connection | undefined> {
    const result = (await this.request(
      `connections/${encodeURIComponent(id)}`,
      "GET",
    )) as Connection;
    return result.active === true && result.connection_id === id && this.valid(result)
      ? result
      : undefined;
  }

  async revoke(id: string): Promise<void> {
    await this.request(`connections/${encodeURIComponent(id)}`, "DELETE");
  }

  private valid(value: Connection): boolean {
    return (
      typeof value.connection_id === "string" &&
      typeof value.user_id === "string" &&
      typeof value.account_id === "string" &&
      Array.isArray(value.scopes) &&
      value.scopes.includes("mcp:read") &&
      value.scopes.every((s) => ["mcp:read", "mcp:write"].includes(s)) &&
      Number.isFinite(Date.parse(value.expires_at)) &&
      Date.parse(value.expires_at) > Date.now()
    );
  }
}
