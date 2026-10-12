import { z } from "zod";

export const imageRecordSchema = z.looseObject({
  asset_id: z.string(),
  alt_text: z.string().nullish(),
  url: z.string().nullish(),
  alt_texts: z.record(z.string(), z.string().nullable()).nullish(),
  tags: z.array(z.string()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  created_at: z.number().nullish(),
  error_code: z.string().nullish(),
  errors: z.record(z.string(), z.array(z.string())).nullish(),
});

export const accountRecordSchema = z.looseObject({
  name: z.string().nullable(),
  usage: z.number(),
  usage_limit: z.number(),
  default_lang: z.string().nullish(),
  gpt_prompt: z.string().nullish(),
  max_chars: z.number().nullish(),
  webhook_url: z.string().nullish(),
  notification_email: z.string().nullish(),
  whitelabel: z.boolean().nullish(),
  no_quotes: z.boolean().nullish(),
  ending_period: z.boolean().nullish(),
  remove_symbols: z.array(z.string()).nullish(),
  subscription: z.unknown().optional(),
  key_kind: z.string().nullish(),
  can_manage_keys: z.boolean().optional(),
});

export const imageListSchema = z.object({
  images: z.array(imageRecordSchema),
  pagination: z.object({
    currentPage: z.number(),
    pageItems: z.number(),
    totalPages: z.number(),
    totalCount: z.number(),
  }),
});

export const deletedImageSchema = z.object({
  asset_id: z.string(),
  deleted: z.literal(true),
});

export const bulkCreateResultSchema = z.looseObject({
  rows: z.number().nullish(),
  row_errors: z.array(z.tuple([z.number(), z.string()])).nullish(),
  error: z.string().nullish(),
});

export const scrapeResultSchema = z.looseObject({
  url: z.string().nullish(),
  scraped_images: z.array(
    z.looseObject({
      src: z.string().nullish(),
      alt: z.string().nullish(),
      width: z.union([z.number(), z.string()]).nullish(),
      height: z.union([z.number(), z.string()]).nullish(),
      skip_reason: z.string().nullish(),
    }),
  ),
  total_processed: z.number(),
  errors: z.record(z.string(), z.array(z.string())).nullish(),
});

// z.object drops undeclared fields, so a token never reaches a masked key's structured output
export const maskedApiKeySchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  kind: z.string(),
  origin: z.string().nullish(),
  integration: z.string().nullish(),
  status: z.string(),
  token_hint: z.string().nullish(),
  usage_limit: z.number().nullish(),
  credits_used: z.number().nullish(),
  billable_credits: z.number().nullish(),
  billable_complete: z.boolean().nullish(),
  period_start: z.string().nullish(),
  resets_at: z.string().nullish(),
  previous_period: z
    .object({
      billable_credits: z.number().nullish(),
      billable_complete: z.boolean().nullish(),
      recorded_at: z.string().nullish(),
    })
    .nullish(),
  created_by: z.object({ type: z.string().nullish(), name: z.string().nullish() }).nullish(),
  created_at: z.string().nullish(),
  last_used_at: z.string().nullish(),
  revoked_at: z.string().nullish(),
  usage: z.record(z.string(), z.unknown()).nullish(),
  integration_warning: z.string().nullish(),
});

export const issuedApiKeySchema = maskedApiKeySchema.extend({ token: z.string() });

export const revealedTokenSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  status: z.string(),
  token: z.string().nullable(),
});

export const apiKeyListSchema = z.object({
  api_keys: z.array(maskedApiKeySchema),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export const apiKeyHistorySchema = z.object({
  api_key_id: z.number(),
  events: z.array(
    z.object({
      id: z.number(),
      action: z.string(),
      actor: z.object({ type: z.string().nullish(), name: z.string().nullish() }).nullish(),
      before: z.record(z.string(), z.unknown()).nullish(),
      after: z.record(z.string(), z.unknown()).nullish(),
      created_at: z.string(),
    }),
  ),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
