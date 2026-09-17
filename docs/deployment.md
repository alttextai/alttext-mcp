# Hosted service deployment

The production image runs the OAuth and Streamable HTTP service on port `3000`. The existing stdio package remains available through `dist/index.js`.

Required settings:

| Variable | Value |
| --- | --- |
| `MCP_ISSUER` | Exact public HTTPS origin, such as `https://mcp.alttext.ai` |
| `MCP_PRODUCT_ORIGIN` | Exact Rails origin, `https://alttext.ai` |
| `MCP_HANDOFF_SECRET` | Shared with Rails; at least 32 bytes |
| `MCP_BRIDGE_SECRET` | Separate shared Rails backchannel secret; at least 32 bytes |
| `MCP_COOKIE_SECRET` | Cookie signing secret; at least 32 bytes |
| `MCP_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes |
| `MCP_JWKS` | JSON Web Key Set containing the private OAuth signing key |
| `MCP_REDIS_URL` | TLS or private-network Redis connection URL |
| `MCP_REDIS_NAMESPACE` | Dedicated namespace, for example `alttext-mcp-production` |
| `MCP_ALLOWED_ORIGINS` | Optional comma-separated additional trusted origins |
| `PORT` | Container port; defaults to `3000` |

Build for the ECS runtime architecture with `docker buildx build --platform linux/amd64`. Route only `mcp.alttext.ai` to this service, terminate TLS at the load balancer, and health-check `/health`.

The trusted edge must limit actual `POST /register` requests by verified source IP. Do not pass an untrusted forwarded address into the application. Keep Rails `MCP_ENABLED=false` until the image, Redis access, DNS/TLS, shared secrets, and discovery endpoints are verified. Then enable Rails and complete live consent, token, read-tool, write-tool, revocation, and cross-account isolation checks.

