import { z } from "zod";
import { formatApiKey, formatApiKeyHistory, formatApiKeyList } from "../formatters.js";
import { change, defineOperation, READ, type OperationAnnotations } from "../registry/operation.js";
import { pageLimit } from "../schemas.js";
import {
  apiKeyHistorySchema,
  apiKeyListSchema,
  issuedApiKeySchema,
  maskedApiKeySchema,
  revealedTokenSchema,
} from "./outputs.js";

const KEY_READ: OperationAnnotations = { ...READ, openWorldHint: false };

const keyId = z.number().int().min(1).describe("The API key's ID");
const cursor = z.string().max(512).optional().describe("Cursor from a previous page's next_cursor");
const limit = pageLimit("Items per page (default: 25, max: 100)");
const idempotencyKey = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe("Reuse the same value when retrying so the change happens once");
const name = z.string().min(1).max(128).describe("Key name, such as the client it belongs to");
const usageLimit = z
  .number()
  .int()
  .min(0)
  .nullable()
  .describe("Credits this key may use per billing period; null means unlimited");

const BILLING_NOTE =
  "billable_credits is uncapped; billable_complete false means the figure may undercount. previous_period is the latest closure, which may be a revocation rather than last month. For historical billing use detail full, match credit_history period_start/period_end to the requested interval, and verify completeness";
const CONFIRM_NOTE =
  "First confirm the key by name and id with the person, and check get_api_key's integration field: an integration key stops working until it reconnects";

// unlike Omit, the remapped keys keep named fields on a record with an index signature
export type WithoutToken<T> = { [K in keyof T as K extends "token" ? never : K]: T[K] };

export function withoutToken<T extends object>(record: T): WithoutToken<T> {
  const copy: Record<string, unknown> = { ...(record as object) };
  delete copy["token"];
  return copy as WithoutToken<T>;
}

export const listApiKeys = defineOperation({
  name: "list_api_keys",
  title: "List API Keys",
  description: `List the account's site API keys with usage and limits. Tokens are masked to their last four characters. ${BILLING_NOTE}. status "all" includes revoked keys`,
  input: z.object({
    after: cursor,
    limit,
    status: z
      .enum(["active", "revoked", "all"])
      .optional()
      .describe("Which keys to list (default: active)"),
    q: z.string().max(256).optional().describe("Match keys whose name contains this text"),
  }),
  output: apiKeyListSchema,
  annotations: KEY_READ,
  permission: "keys_read",
  localFilesOnly: false,
  command: { noun: "keys", verb: "list" },
  async handler(api, { after, limit, status, q }) {
    const list = await api.listApiKeys({ after, limit, status, q });
    const masked = { ...list, api_keys: list.api_keys.map(withoutToken) };
    return { text: formatApiKeyList(masked), structured: masked };
  },
});

export const getApiKey = defineOperation({
  name: "get_api_key",
  title: "Get API Key",
  description: `Get one API key's details, usage and limit. The token is masked; use reveal_api_key_token to see it. ${BILLING_NOTE}`,
  input: z.object({
    id: keyId,
    detail: z
      .enum(["concise", "full"])
      .optional()
      .describe("full adds usage history, domains and credit periods (default: concise)"),
  }),
  output: maskedApiKeySchema,
  annotations: KEY_READ,
  permission: "keys_read",
  localFilesOnly: false,
  command: { noun: "keys", verb: "get" },
  async handler(api, { id, detail }) {
    const key = withoutToken(
      await api.getApiKey({ id, detail: detail === "full" ? "full" : undefined }),
    );
    return { text: formatApiKey(key), structured: key };
  },
});

export const revealApiKeyToken = defineOperation({
  name: "reveal_api_key_token",
  title: "Reveal API Key Token",
  description:
    "Show one API key's full token. The reveal is recorded in the key's history. Only use when the person asks for this key's token",
  input: z.object({ id: keyId }),
  output: revealedTokenSchema,
  annotations: change({ destructive: false, idempotent: true, openWorld: false }),
  permission: "keys_write",
  localFilesOnly: false,
  command: { noun: "keys", verb: "reveal" },
  async handler(api, { id }) {
    const key = await api.getApiKey({ id, reveal: true });
    const token = key.token ?? null;
    return {
      text: token
        ? `Token for key ${String(key.id)} (${key.name ?? "unnamed"}): ${token}`
        : `Key ${String(key.id)} is ${key.status} and has no token.`,
      structured: { id: key.id, name: key.name, status: key.status, token },
    };
  },
});

export const createApiKey = defineOperation({
  name: "create_api_key",
  title: "Create API Key",
  description:
    "Create a site API key, optionally with a per-period credit limit. Returns the new token",
  input: z.object({
    name,
    usage_limit: usageLimit.optional(),
    idempotency_key: idempotencyKey,
  }),
  output: issuedApiKeySchema,
  annotations: change({ destructive: false, idempotent: false, openWorld: false }),
  permission: "keys_write",
  localFilesOnly: false,
  command: { noun: "keys", verb: "create" },
  async handler(api, input) {
    const key = await api.createApiKey({
      name: input.name,
      usageLimit: input.usage_limit,
      idempotencyKey: input.idempotency_key,
    });
    return {
      text: `Created key ${String(key.id)}.\nToken: ${key.token ?? ""}\n\n${formatApiKey(key)}`,
      structured: key,
    };
  },
});

export const updateApiKey = defineOperation({
  name: "update_api_key",
  title: "Update API Key",
  description: "Rename an API key or change its per-period credit limit (null removes the limit)",
  input: z.object({
    id: keyId,
    name: name.optional(),
    usage_limit: usageLimit.optional(),
  }),
  output: maskedApiKeySchema,
  annotations: change({ destructive: true, idempotent: true, openWorld: false }),
  permission: "keys_write",
  localFilesOnly: false,
  command: { noun: "keys", verb: "update" },
  async handler(api, input) {
    const key = withoutToken(
      await api.updateApiKey({
        id: input.id,
        name: input.name,
        usageLimit: input.usage_limit,
      }),
    );
    return { text: `Updated key ${String(key.id)}:\n\n${formatApiKey(key)}`, structured: key };
  },
});

export const rotateApiKey = defineOperation({
  name: "rotate_api_key",
  title: "Rotate API Key",
  description: `Replace an API key's token. The old token stops working immediately. Returns the new token. ${CONFIRM_NOTE}`,
  input: z.object({ id: keyId, idempotency_key: idempotencyKey }),
  output: issuedApiKeySchema,
  annotations: change({ destructive: true, idempotent: false, openWorld: false }),
  permission: "keys_write",
  localFilesOnly: false,
  command: { noun: "keys", verb: "rotate" },
  async handler(api, { id, idempotency_key }) {
    const key = await api.rotateApiKey({ id, idempotencyKey: idempotency_key });
    return {
      text: `Rotated key ${String(key.id)}. The old token no longer works.\nNew token: ${key.token ?? ""}\n\n${formatApiKey(key)}`,
      structured: key,
    };
  },
});

export const revokeApiKey = defineOperation({
  name: "revoke_api_key",
  title: "Revoke API Key",
  description: `Revoke an API key. Its token stops working immediately; the key and its usage stay readable. ${CONFIRM_NOTE}`,
  input: z.object({ id: keyId }),
  output: maskedApiKeySchema,
  annotations: change({ destructive: true, idempotent: true, openWorld: false }),
  permission: "keys_write",
  localFilesOnly: false,
  command: { noun: "keys", verb: "revoke" },
  async handler(api, { id }) {
    const key = withoutToken(await api.revokeApiKey({ id }));
    return { text: `Revoked key ${String(key.id)}.\n\n${formatApiKey(key)}`, structured: key };
  },
});

export const listApiKeyHistory = defineOperation({
  name: "list_api_key_history",
  title: "List API Key History",
  description: "List the recorded changes to one API key, newest first, with who made each",
  input: z.object({ id: keyId, after: cursor, limit }),
  output: apiKeyHistorySchema,
  annotations: KEY_READ,
  permission: "keys_read",
  localFilesOnly: false,
  command: { noun: "keys", verb: "history" },
  async handler(api, { id, after, limit }) {
    const history = await api.listApiKeyHistory({ id, after, limit });
    return {
      text: formatApiKeyHistory(id, history),
      structured: { api_key_id: id, ...history },
    };
  },
});
