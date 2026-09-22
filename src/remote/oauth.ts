import Provider, { errors, type Configuration } from "oidc-provider";
import type { RemoteConfig } from "./config.js";
import type { OAuthStore } from "./store.js";
import type { ProductBridge } from "./product-bridge.js";

export function createOAuth(
  config: RemoteConfig,
  store: OAuthStore,
  bridge: ProductBridge,
): Provider {
  const settings: Configuration = {
    adapter: function (name: string) {
      return store.adapter(name);
    },
    jwks: config.jwks,
    cookies: {
      keys: config.cookieKeys,
      long: { secure: !config.testing },
      short: { secure: !config.testing },
    },
    clientAuthMethods: ["none", "client_secret_basic", "client_secret_post"],
    claims: {},
    scopes: ["openid", "mcp:read", "mcp:write"],
    responseTypes: ["code"],
    clientDefaults: {
      id_token_signed_response_alg: "ES256",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid mcp:read mcp:write",
    },
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      registration: { enabled: true, issueRegistrationAccessToken: false },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        useGrantedResource: () => false,
        getResourceServerInfo: (_ctx, resource) => {
          if (resource !== config.resource) throw new errors.InvalidTarget();
          return {
            scope: "mcp:read mcp:write",
            audience: config.resource,
            accessTokenTTL: 900,
            accessTokenFormat: "opaque",
          };
        },
      },
    },
    extraClientMetadata: {
      properties: ["mcp_policy"],
      validator: (_ctx, _key, _value, metadata) => {
        for (const field of ["jwks_uri", "sector_identifier_uri", "request_uris"] as const) {
          if (metadata[field] !== undefined)
            throw new errors.InvalidClientMetadata("Remote client metadata URLs are unsupported");
        }
        if (!metadata.redirect_uris?.length || metadata.redirect_uris.length > 10)
          throw new errors.InvalidClientMetadata("redirect_uris required");
        for (const value of metadata.redirect_uris) {
          const url = new URL(value);
          if (
            url.hash ||
            url.username ||
            url.password ||
            value.includes("*") ||
            (url.protocol !== "https:" &&
              !(config.testing && url.protocol === "http:" && url.hostname === "127.0.0.1"))
          ) {
            throw new errors.InvalidClientMetadata("HTTPS redirects without wildcards required");
          }
        }
        if (
          metadata.grant_types?.some(
            (type) => !["authorization_code", "refresh_token"].includes(type),
          )
        )
          throw new errors.InvalidClientMetadata("Unsupported grant type");
        if (typeof metadata.client_name === "string" && metadata.client_name.length > 160)
          throw new errors.InvalidClientMetadata("Client name too long");
      },
    },
    interactions: { url: () => "/oauth/interaction" },
    findAccount: async (_ctx, id) => {
      const connection = await bridge.status(id);
      return connection ? { accountId: id, claims: () => ({ sub: id }) } : undefined;
    },
    loadExistingGrant: async (ctx) => {
      const grantId = ctx.oidc.result?.consent?.grantId;
      return grantId ? ctx.oidc.provider.Grant.find(grantId) : undefined;
    },
    issueRefreshToken: () => true,
    expiresWithSession: () => false,
    revokeGrantPolicy: async (ctx) => {
      if (ctx.oidc.route === "revocation" && ctx.oidc.entities.AccessToken) return false;
      const source = ctx.oidc.entities.RefreshToken ?? ctx.oidc.entities.AuthorizationCode;
      if (source?.accountId) {
        await bridge.revoke(source.accountId);
        await store.adapter("Connection").destroy(source.accountId);
      }
      return true;
    },
    rotateRefreshToken: true,
    extraTokenClaims: (ctx) => {
      if (ctx.oidc.params?.["resource"] !== config.resource)
        throw new errors.InvalidTarget("Exact resource required");
      return {};
    },
    ttl: {
      AccessToken: 900,
      AuthorizationCode: 60,
      RefreshToken: 30 * 86400,
      Grant: 90 * 86400,
      Interaction: 300,
      Session: 86400,
    },
    routes: {
      authorization: "/authorize",
      token: "/token",
      registration: "/register",
      revocation: "/revoke",
    },
    renderError: (ctx, out) => {
      ctx.type = "application/json";
      ctx.body = { error: out.error };
    },
  };
  const provider = new Provider(config.issuer, settings);
  // The public issuer is fixed; forwarded headers must be replaced by the deployment proxy.
  provider.proxy = true;
  return provider;
}
