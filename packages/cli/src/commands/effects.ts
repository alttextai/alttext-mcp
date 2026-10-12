import type { AltTextApi, Operation } from "@alttext_ai/core";

export type Target = Record<string, unknown>;

export interface Effect {
  readonly summary: string;
  readonly consequences: readonly string[];
}

const INTEGRATIONS: Readonly<Record<string, string>> = {
  shopify: "Shopify",
  bigcommerce: "BigCommerce",
  wordpress_connect: "WordPress Connect",
};

/** Operations that confirm interactively and need --yes without a terminal. */
export const CONFIRMED_OPERATIONS: ReadonlySet<string> = new Set([
  "rotate_api_key",
  "revoke_api_key",
  "delete_image",
  "update_account",
]);

export function withoutToken(record: object): Target {
  const copy: Target = { ...record };
  delete copy["token"];
  return copy;
}

/** Reads what a change would act on, so a confirmation or dry run can name it. */
export async function readTarget(
  api: AltTextApi,
  operation: Operation,
  input: Record<string, unknown>,
): Promise<Target | null> {
  const { noun } = operation.command;
  if (noun === "keys" && typeof input["id"] === "number") {
    return withoutToken(await api.getApiKey({ id: input["id"] }));
  }
  if (noun === "images" && typeof input["asset_id"] === "string") {
    if (operation.name !== "delete_image" && operation.name !== "update_image") return null;
    return { ...(await api.getImage({ assetId: input["asset_id"] })) };
  }
  if (operation.name === "update_account") return { ...(await api.getAccount()) };
  return null;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

function limitText(value: unknown): string {
  return typeof value === "number" ? `${String(value)} credits` : "unlimited";
}

function keyLabel(key: Target): string {
  const hint = typeof key["token_hint"] === "string" ? ` (token …${key["token_hint"]})` : "";
  return `key ${String(key["id"])} ${show(key["name"])}${hint}`;
}

function integrationNotice(key: Target): string[] {
  const integration = key["integration"];
  if (typeof integration !== "string" || integration === "") return [];
  const name = INTEGRATIONS[integration] ?? integration;
  return [
    `It belongs to your ${name} integration, which stops working until it reconnects with a new key.`,
  ];
}

function changes(
  input: Record<string, unknown>,
  target: Target | null,
  fields: readonly string[],
): string {
  const listed = fields
    .filter((field) => input[field] !== undefined)
    .map((field) => {
      const next = field === "usage_limit" ? limitText(input[field]) : show(input[field]);
      if (target === null) return `${field} ${next}`;
      const before = field === "usage_limit" ? limitText(target[field]) : show(target[field]);
      return `${field} ${before} → ${next}`;
    });
  return listed.length > 0 ? listed.join(", ") : "no changes";
}

/** Describes what running the operation would do, naming the target and what can't be undone. */
export function describeEffect(
  operation: Operation,
  input: Record<string, unknown>,
  target: Target | null,
): Effect {
  const key = target ?? { id: input["id"] };
  switch (operation.name) {
    case "create_api_key":
      return {
        summary: `Create key ${show(input["name"])} with a limit of ${limitText(input["usage_limit"])} per period`,
        consequences: [],
      };
    case "update_api_key":
      return {
        summary: `Update ${keyLabel(key)}: ${changes(input, target, ["name", "usage_limit"])}`,
        consequences: [],
      };
    case "rotate_api_key":
      return {
        summary: `Rotate ${keyLabel(key)}`,
        consequences: ["The old token stops working immediately.", ...integrationNotice(key)],
      };
    case "revoke_api_key":
      return {
        summary: `Revoke ${keyLabel(key)}`,
        consequences: [
          "Its token stops working immediately, and revocation can't be undone.",
          ...integrationNotice(key),
        ],
      };
    case "reveal_api_key_token":
      return {
        summary: `Reveal the token of ${keyLabel(key)}`,
        consequences: ["The reveal is recorded in the key's history."],
      };
    case "delete_image": {
      const url = typeof target?.["url"] === "string" ? ` (${target["url"]})` : "";
      return {
        summary: `Delete image ${String(input["asset_id"])}${url}`,
        consequences: ["This can't be undone."],
      };
    }
    case "update_image":
      return {
        summary: `Update image ${String(input["asset_id"])}: ${changes(input, target, ["alt_text", "tags", "metadata", "lang", "overwrite"])}`,
        consequences: [],
      };
    case "update_account":
      return {
        summary: `Update account ${show(target?.["name"])}: ${changes(input, target, ["name", "webhook_url", "notification_email"])}`,
        consequences: [],
      };
    default:
      return { summary: `${operation.title} with ${JSON.stringify(input)}`, consequences: [] };
  }
}
