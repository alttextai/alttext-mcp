import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type Provider from "oidc-provider";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isJSONRPCResultResponse, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Permission } from "@alttext_ai/core";
import type { RemoteConfig } from "./config.js";
import { type Connection, ProductBridge, signHandoff } from "./product-bridge.js";
import { REQUIRED_SCOPES, SCOPES } from "./scopes.js";
import { isOpenAIClient, type OAuthStore } from "./store.js";

interface Handoff {
  nonce: string;
  // absent on handoffs written before openid support
  oidcScopes?: string[];
  scopes: string[];
}
const OPENAI_APPS_CHALLENGE = "PlUuJJowjOgZmLFWv_wfh-9vnZDPkIcgxyaP-82wOqw";
const MISSING_SCOPE: Record<string, string> = {
  // only all-OpenAI clients can step up in place; any other client registered its scope ceiling
  "mcp:keys":
    "This connection cannot manage API keys. Remove and re-add the AltText.ai connector with 'Manage API keys' ticked, or manage keys in the AltText.ai dashboard or the alttext CLI with a full-access key.",
  "mcp:write":
    "This connection has read-only access. Reconnect the assistant and allow write access.",
};
const OPENAI_DENIAL: Record<string, string> = {
  "mcp:keys":
    "needs the Manage API keys permission (mcp:keys). Reconnect AltText.ai with Manage API keys ticked to allow it.",
  "mcp:write": "needs write access (mcp:write). Reconnect AltText.ai to allow it.",
};
export interface Catalog {
  create: (apiKey: string) => McpServer;
  // a tool missing from the map needs write access
  permissions: ReadonlyMap<string, Permission>;
}
// ChatGPT reads securitySchemes from the tool descriptor, and the SDK only emits _meta
function mirrorSecuritySchemes(message: JSONRPCMessage): JSONRPCMessage {
  if (!isJSONRPCResultResponse(message) || !Array.isArray(message.result["tools"])) return message;
  const tools = (message.result["tools"] as { _meta?: Record<string, unknown> }[]).map((tool) =>
    tool._meta?.["securitySchemes"]
      ? { ...tool, securitySchemes: tool._meta["securitySchemes"] }
      : tool,
  );
  return { ...message, result: { ...message.result, tools } };
}
/** The MCP scopes in a space-separated scope string. */
function mcpScopes(scope?: string): string[] {
  return (scope ?? "").split(" ").filter((s) => s.startsWith("mcp:"));
}
const equal = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createHttp(
  config: RemoteConfig,
  store: OAuthStore,
  bridge: ProductBridge,
  oauth: Provider,
  catalog: Catalog,
) {
  const oauthCallback = oauth.callback();
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const redirect = (res: ServerResponse, location: string): void => {
    res.writeHead(303, {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    res.end();
  };
  return createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 503, { error: "temporarily_unavailable" });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", config.issuer);
    const publicUrl = new URL(config.issuer);
    // Load balancer health checks use the target IP as the Host header. Keep the
    // probe outside the public-origin gate; the task security group still limits
    // this port to the load balancer.
    if (url.pathname === "/health") {
      await store.redis.ping();
      send(res, 200, { healthy: true });
      return;
    }
    if (req.headers.host !== publicUrl.host) {
      send(res, 403, { error: "untrusted_host" });
      return;
    }
    // Only trust the configured external origin; clients cannot choose issuer through proxy headers.
    delete req.headers["x-forwarded-host"];
    delete req.headers["forwarded"];
    req.headers["x-forwarded-proto"] = publicUrl.protocol.slice(0, -1);
    if (req.headers.origin && !config.origins.has(req.headers.origin)) {
      send(res, 403, { error: "untrusted_origin" });
      return;
    }
    if (Number(req.headers["content-length"] ?? 0) > 1_048_576) {
      send(res, 413, { error: "request_too_large" });
      return;
    }
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(OPENAI_APPS_CHALLENGE);
      return;
    }
    if (
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp"
    ) {
      send(res, 200, {
        resource: config.resource,
        authorization_servers: [config.issuer],
        // clients register with these (MCP 2025-11-25 Scope Selection Strategy), so openid must be here
        scopes_supported: SCOPES,
        bearer_methods_supported: ["header"],
      });
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      req.url = "/.well-known/openid-configuration";
      await oauthCallback(req, res);
      return;
    }
    if (url.pathname === "/authorize" && url.searchParams.get("resource") !== config.resource) {
      send(res, 400, { error: "invalid_target" });
      return;
    }
    if (url.pathname === "/authorize" || url.pathname.startsWith("/authorize/")) {
      // Each product grant gets its own subject. Reuse Rails login, not a prior
      // provider session, so choosing another account never logs out its grants.
      const sessionCookie = oauth.cookieName("session");
      req.headers.cookie = (req.headers.cookie ?? "")
        .split(";")
        .filter((part) => {
          const name = part.trim().split("=")[0];
          return name !== sessionCookie && name !== `${sessionCookie}.sig`;
        })
        .join(";");
    }
    if (url.pathname === "/oauth/interaction") {
      if (req.method !== "GET") {
        send(res, 405, { error: "method_not_allowed" });
        return;
      }
      const detail = await oauth.interactionDetails(req, res);
      const rawScope = detail.params["scope"];
      const requested = typeof rawScope === "string" ? rawScope : "mcp:read";
      const requestedScopes = requested.split(" ").filter(Boolean);
      if (requestedScopes.some((s) => !SCOPES.includes(s))) {
        send(res, 400, { error: "invalid_scope" });
        return;
      }
      const client = await oauth.Client.find(String(detail.params["client_id"]));
      if (!client || detail.params["resource"] !== config.resource) {
        send(res, 400, { error: "invalid_client" });
        return;
      }
      // an OpenID-only request asks for the client's registered MCP scope ceiling
      const scopes = [mcpScopes(requested), mcpScopes(client.scope)].find(
        (list) => list.length,
      ) ?? ["mcp:read", "mcp:write"];
      if (!scopes.includes("mcp:read")) {
        send(res, 400, { error: "invalid_scope" });
        return;
      }
      const oidcScopes = requestedScopes.filter((scope) => scope === "openid");
      const nonce = randomBytes(32).toString("base64url");
      await store.put("Handoff", detail.uid, { nonce, oidcScopes, scopes }, 300);
      const now = Math.floor(Date.now() / 1000);
      const handoff = signHandoff(
        {
          v: 1,
          iss: config.issuer,
          aud: config.productOrigin,
          iat: now,
          exp: now + 300,
          interaction_id: detail.uid,
          nonce,
          return_url: `${config.issuer}/oauth/interaction/callback`,
          client_id: client.clientId,
          client_name: client.clientName ?? "Unnamed client",
          redirect_host: new URL(String(detail.params["redirect_uri"])).host,
          scopes,
        },
        config.handoffSecret,
      );
      redirect(
        res,
        `${config.productOrigin}/mcp/connections/new?handoff=${encodeURIComponent(handoff)}`,
      );
      return;
    }
    if (url.pathname === "/oauth/interaction/callback") {
      const detail = await oauth.interactionDetails(req, res);
      const state = await store.get<Handoff>("Handoff", detail.uid);
      if (
        !state ||
        detail.uid !== url.searchParams.get("interaction_id") ||
        !equal(state.nonce, url.searchParams.get("state") ?? "")
      ) {
        send(res, 400, { error: "invalid_state" });
        return;
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.get("error") !== "access_denied" && (!code || code.length > 512)) {
        send(res, 400, { error: "invalid_grant" });
        return;
      }
      // Claim the callback before the non-retryable key exchange.
      await store.adapter("Handoff").consume(detail.uid);
      if (url.searchParams.get("error") === "access_denied") {
        await oauth.interactionFinished(
          req,
          res,
          { error: "access_denied" },
          { mergeWithLastSubmission: false },
        );
        return;
      }
      const connection = await bridge.redeem(code ?? "", detail.uid, state.nonce);
      if (connection.scopes.some((s) => !state.scopes.includes(s)))
        throw new Error("Scope escalation");
      await store.put(
        "Connection",
        connection.connection_id,
        connection as unknown as Record<string, unknown>,
        Math.ceil((Date.parse(connection.expires_at) - Date.now()) / 1000),
      );
      const grant = new oauth.Grant({
        accountId: connection.connection_id,
        clientId: String(detail.params["client_id"]),
      });
      grant.addResourceScope(config.resource, connection.scopes.join(" "));
      grant.addOIDCScope([...(state.oidcScopes ?? []), ...connection.scopes].join(" "));
      const grantId = await grant.save();
      await oauth.interactionFinished(
        req,
        res,
        { login: { accountId: connection.connection_id }, consent: { grantId } },
        { mergeWithLastSubmission: false },
      );
      return;
    }
    if (url.pathname === "/mcp") {
      await mcp(req, res);
      return;
    }
    await oauthCallback(req, res);
  }

  async function mcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const resourceMetadata = `${config.issuer}/.well-known/oauth-protected-resource/mcp`;
    const deny = (): void => {
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadata}"`);
      send(res, 401, { error: "invalid_token" });
    };
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "");
    if (!match?.[1]) {
      deny();
      return;
    }
    const token = await oauth.AccessToken.find(match[1]);
    if (!token?.accountId || token.aud !== config.resource) {
      deny();
      return;
    }
    const [stored, current] = await Promise.all([
      store.get<Connection>("Connection", token.accountId),
      bridge.status(token.accountId),
    ]);
    if (!stored?.api_key || !current) {
      deny();
      return;
    }
    const requestedMcpScopes = mcpScopes(token.scope);
    const scopes = (requestedMcpScopes.length ? requestedMcpScopes : current.scopes).filter(
      (scope) => current.scopes.includes(scope) && stored.scopes.includes(scope),
    );
    if (!scopes.includes("mcp:read")) {
      send(res, 403, { error: "insufficient_scope" });
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "method_not_allowed" });
      return;
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk as Uint8Array);
      bytes += buffer.length;
      if (bytes > 1_048_576) {
        send(res, 413, { error: "request_too_large" });
        return;
      }
      chunks.push(buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString()) as unknown;
    } catch {
      send(res, 400, { error: "invalid_json" });
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      send(res, 400, { error: "invalid_request" });
      return;
    }
    const request = body as { id?: unknown; method?: string; params?: { name?: string } };
    const needed =
      request.method === "tools/call"
        ? REQUIRED_SCOPES[catalog.permissions.get(request.params?.name ?? "") ?? "write"]
        : [];
    const missing = needed.find((scope) => !scopes.includes(scope));
    if (missing) {
      // the challenge keeps every scope the connection holds so stepping up never drops one
      const challengeScopes = SCOPES.filter(
        (scope) => scope === "openid" || scopes.includes(scope) || needed.includes(scope),
      );
      const description = MISSING_SCOPE[missing] ?? "";
      const challenge = `Bearer resource_metadata="${resourceMetadata}", error="insufficient_scope", error_description="${description}", scope="${challengeScopes.join(" ")}"`;
      const client = await oauth.Client.find(String(token.clientId));
      // ChatGPT ignores an HTTP 403 and only re-links with the scope named in a tool-result challenge
      if (client && isOpenAIClient(client.metadata())) {
        const tool = request.params?.name ? `The ${request.params.name} tool` : "This tool";
        send(res, 200, {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            content: [{ type: "text", text: `${tool} ${OPENAI_DENIAL[missing] ?? ""}` }],
            isError: true,
            _meta: { "mcp/www_authenticate": [challenge] },
          },
        });
        return;
      }
      res.setHeader("WWW-Authenticate", challenge);
      send(res, 403, {
        error: "insufficient_scope",
        required_scope: missing,
        error_description: description,
      });
      return;
    }
    const server = catalog.create(stored.api_key);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const forward = transport.send.bind(transport);
    transport.send = (message, options) => forward(mirrorSecuritySchemes(message), options);
    res.on("close", () => {
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
