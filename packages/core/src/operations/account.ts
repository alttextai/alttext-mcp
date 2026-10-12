import { z } from "zod";
import { formatAccount } from "../formatters.js";
import { change, defineOperation, READ } from "../registry/operation.js";
import type { AccountRecord } from "../types.js";
import { accountRecordSchema } from "./outputs.js";

/** What the calling key is and whether it may manage keys. */
export function keyAccess(account: AccountRecord): {
  key_kind: string | null;
  can_manage_keys: boolean;
} {
  return {
    key_kind: account.api_key?.kind ?? null,
    can_manage_keys: account.api_key?.can_manage_keys === true,
  };
}

export const getAccount = defineOperation({
  name: "get_account",
  title: "Get Account",
  description: "Get your AltText.ai account info including credit balance, usage, and settings",
  input: z.object({}),
  output: accountRecordSchema,
  annotations: READ,
  permission: "read",
  localFilesOnly: false,
  command: { noun: "account", verb: "get" },
  async handler(api) {
    const account = await api.getAccount();
    return {
      text: formatAccount(account),
      structured: { ...account, ...keyAccess(account) },
    };
  },
});

export const updateAccount = defineOperation({
  name: "update_account",
  title: "Update Account",
  description: "Update your AltText.ai account settings (name, webhook URL, notification email)",
  input: z.object({
    name: z.string().max(256).optional().describe("Account name"),
    webhook_url: z.url().optional().describe("Webhook URL for processing notifications"),
    notification_email: z.email().optional().describe("Email address for notifications"),
  }),
  output: accountRecordSchema,
  annotations: change({ destructive: true, idempotent: true, openWorld: true }),
  permission: "write",
  localFilesOnly: false,
  command: { noun: "account", verb: "update" },
  async handler(api, { name, webhook_url, notification_email }) {
    const account = await api.updateAccount({
      name,
      webhookUrl: webhook_url,
      notificationEmail: notification_email,
    });
    return {
      text: `Updated account settings:\n\n${formatAccount(account)}`,
      structured: account,
    };
  },
});
