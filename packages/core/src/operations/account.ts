import { z } from "zod";
import { formatAccount } from "../formatters.js";
import { defineOperation } from "../registry/operation.js";
import { accountRecordSchema } from "./outputs.js";

export const getAccount = defineOperation({
  name: "get_account",
  title: "Get Account",
  description: "Get your AltText.ai account info including credit balance, usage, and settings",
  input: z.object({}),
  output: accountRecordSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  permission: "read",
  localFilesOnly: false,
  command: { noun: "account", verb: "get" },
  async handler(api) {
    const account = await api.getAccount();
    return {
      text: formatAccount(account),
      structured: {
        ...account,
        key_kind: account.api_key?.kind ?? null,
        can_manage_keys: account.api_key?.can_manage_keys === true,
      },
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
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
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
