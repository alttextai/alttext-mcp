import {
  createApiKey,
  deleteImage,
  revealApiKeyToken,
  revokeApiKey,
  rotateApiKey,
  updateAccount,
  updateApiKey,
  updateImage,
  withoutToken,
  type AltTextApi,
  type Operation,
} from "@alttext_ai/core";

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
  rotateApiKey.name,
  revokeApiKey.name,
  deleteImage.name,
  updateAccount.name,
]);

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
    if (operation.name !== deleteImage.name && operation.name !== updateImage.name) return null;
    return { ...(await api.getImage({ assetId: input["asset_id"] })) };
  }
  if (operation.name === updateAccount.name) return { ...(await api.getAccount()) };
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
    case createApiKey.name:
      return {
        summary: `Create key ${show(input["name"])} with a limit of ${limitText(input["usage_limit"])} per period`,
        consequences: [],
      };
    case updateApiKey.name:
      return {
        summary: `Update ${keyLabel(key)}: ${changes(input, target, ["name", "usage_limit"])}`,
        consequences: [],
      };
    case rotateApiKey.name:
      return {
        summary: `Rotate ${keyLabel(key)}`,
        consequences: ["The old token stops working immediately.", ...integrationNotice(key)],
      };
    case revokeApiKey.name:
      return {
        summary: `Revoke ${keyLabel(key)}`,
        consequences: [
          "Its token stops working immediately, and revocation can't be undone.",
          ...integrationNotice(key),
        ],
      };
    case revealApiKeyToken.name:
      return {
        summary: `Reveal the token of ${keyLabel(key)}`,
        consequences: ["The reveal is recorded in the key's history."],
      };
    case deleteImage.name: {
      const url = typeof target?.["url"] === "string" ? ` (${target["url"]})` : "";
      return {
        summary: `Delete image ${String(input["asset_id"])}${url}`,
        consequences: ["This can't be undone."],
      };
    }
    case updateImage.name:
      return {
        summary: `Update image ${String(input["asset_id"])}: ${changes(input, target, ["alt_text", "tags", "metadata", "lang", "overwrite"])}`,
        consequences: [],
      };
    case updateAccount.name:
      return {
        summary: `Update account ${show(target?.["name"])}: ${changes(input, target, ["name", "webhook_url", "notification_email"])}`,
        consequences: [],
      };
    default:
      return { summary: `${operation.title} with ${JSON.stringify(input)}`, consequences: [] };
  }
}
