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
  remove_symbols: z.boolean().nullish(),
  subscription: z.unknown().optional(),
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
  row_errors: z.array(z.string()).nullish(),
  error: z.string().nullish(),
});

export const scrapeResultSchema = z.looseObject({
  url: z.string().nullish(),
  scraped_images: z.array(
    z.looseObject({
      src: z.string().nullish(),
      alt: z.string().nullish(),
      width: z.number().nullish(),
      height: z.number().nullish(),
      skip_reason: z.string().nullish(),
    }),
  ),
  total_processed: z.number(),
  errors: z.record(z.string(), z.array(z.string())).nullish(),
});
