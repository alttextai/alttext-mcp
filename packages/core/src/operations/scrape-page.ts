import { z } from "zod";
import { formatScrapeResult } from "../formatters.js";
import { change, defineOperation } from "../registry/operation.js";
import { scrapeOptionsSchema } from "../schemas.js";
import { scrapeResultSchema } from "./outputs.js";

export const scrapePage = defineOperation({
  name: "scrape_page",
  title: "Scrape Page",
  description:
    "Find images on a web page and queue alt-text generation jobs. Uses account credits. Images are processed asynchronously; inspect the image library for results.",
  input: z.object({
    url: z.url().describe("URL of the web page to scrape"),
    html: z
      .string()
      .max(500_000)
      .optional()
      .describe("Optional HTML override (if omitted, server fetches the page)"),
    include_existing: z.boolean().optional().describe("Include images that already have alt text"),
    ...scrapeOptionsSchema,
  }),
  output: scrapeResultSchema,
  annotations: change({ destructive: true, idempotent: false, openWorld: true }),
  permission: "write",
  localFilesOnly: false,
  command: { noun: "pages", verb: "scrape" },
  async handler(
    api,
    { url, html, include_existing, lang, keywords, negative_keywords, gpt_prompt, max_chars },
  ) {
    const result = await api.scrapePage({
      url,
      html,
      includeExisting: include_existing,
      lang,
      keywords,
      negativeKeywords: negative_keywords,
      gptPrompt: gpt_prompt,
      maxChars: max_chars,
    });
    return { text: formatScrapeResult(result, url), structured: result };
  },
});
