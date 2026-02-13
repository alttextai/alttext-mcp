import { z } from "zod";

/** Shared schema fields for alt text generation options. */
export const generationOptionsSchema = {
  asset_id: z
    .string()
    .max(256)
    .optional()
    .describe("Custom asset ID (default: auto-generated hash)"),
  lang: z
    .string()
    .max(64)
    .optional()
    .describe("Comma-separated language codes (e.g. 'en', 'en,fr,es')"),
  keywords: z.array(z.string().max(128)).max(20).optional().describe("Keywords to incorporate"),
  negative_keywords: z.array(z.string().max(128)).max(20).optional().describe("Keywords to avoid"),
  gpt_prompt: z
    .string()
    .max(768)
    .optional()
    .describe(
      "Custom prompt template. Use {{AltText}} as a placeholder for the generated alt text.",
    ),
  max_chars: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Maximum character length for the alt text"),
  overwrite: z
    .boolean()
    .optional()
    .describe("Overwrite existing alt text if image was previously processed"),
  tags: z.array(z.string().max(128)).max(50).optional().describe("Tags for organization"),
  metadata: z
    .record(z.string().max(256))
    .optional()
    .describe("Custom metadata (string key-value pairs)"),
} as const;

/** Subset of generation options for page scraping. */
export const scrapeOptionsSchema = {
  lang: z.string().max(64).optional().describe("Language codes for generation"),
  keywords: z.array(z.string().max(128)).max(20).optional().describe("Keywords to incorporate"),
  negative_keywords: z.array(z.string().max(128)).max(20).optional().describe("Keywords to avoid"),
  gpt_prompt: z.string().max(768).optional().describe("Custom prompt override"),
  max_chars: z.number().int().min(1).max(1000).optional().describe("Maximum character length"),
} as const;
