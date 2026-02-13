#!/usr/bin/env node

import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AltTextApi, AltTextApiError } from "./alttext-api.js";
import { formatAccount, formatImage, formatImageList, formatScrapeResult } from "./formatters.js";
import { generationOptionsSchema, scrapeOptionsSchema } from "./schemas.js";
import type { GenerateOptions } from "./types.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".svg",
  ".avif",
]);

// -- Startup --

const apiKey = process.env["ALTTEXT_API_KEY"];
if (!apiKey) {
  console.error("ALTTEXT_API_KEY environment variable is required");
  process.exit(1);
}

const api = new AltTextApi(apiKey, process.env["ALTTEXT_API_BASE_URL"]);
const server = new McpServer({ name: "alttext-ai", version: "1.0.0" });

// -- Helpers --

function textContent(text: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text }] };
}

function errorContent(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof AltTextApiError) {
    const parts = [`Error (${String(err.status)}): ${err.message}`];
    if (err.errorCode) parts.push(`Code: ${err.errorCode}`);
    return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

async function resolveAndValidateFile(
  filePath: string,
  allowedExtensions?: ReadonlySet<string>,
): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  if (allowedExtensions) {
    const ext = extname(resolved).toLowerCase();
    if (!allowedExtensions.has(ext)) {
      throw new Error(
        `Unsupported file type: ${ext || "(none)"}. Supported: ${[...allowedExtensions].join(", ")}`,
      );
    }
  }

  const stats = await stat(resolved);
  if (!stats.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${String(stats.size)} bytes, max ${String(MAX_FILE_SIZE)})`);
  }

  return resolved;
}

function toGenerateOptions(args: Record<string, unknown>): GenerateOptions {
  const opts: GenerateOptions = {};
  if (args["asset_id"] !== undefined)
    (opts as Record<string, unknown>)["assetId"] = args["asset_id"];
  if (args["lang"] !== undefined) (opts as Record<string, unknown>)["lang"] = args["lang"];
  if (args["keywords"] !== undefined)
    (opts as Record<string, unknown>)["keywords"] = args["keywords"];
  if (args["negative_keywords"] !== undefined)
    (opts as Record<string, unknown>)["negativeKeywords"] = args["negative_keywords"];
  if (args["gpt_prompt"] !== undefined)
    (opts as Record<string, unknown>)["gptPrompt"] = args["gpt_prompt"];
  if (args["max_chars"] !== undefined)
    (opts as Record<string, unknown>)["maxChars"] = args["max_chars"];
  if (args["overwrite"] !== undefined)
    (opts as Record<string, unknown>)["overwrite"] = args["overwrite"];
  if (args["tags"] !== undefined) (opts as Record<string, unknown>)["tags"] = args["tags"];
  if (args["metadata"] !== undefined)
    (opts as Record<string, unknown>)["metadata"] = args["metadata"];
  return opts;
}

// ============================================================
// Account Management
// ============================================================

server.registerTool(
  "get_account",
  {
    title: "Get Account",
    description: "Get your AltText.ai account info including credit balance, usage, and settings",
    inputSchema: {},
  },
  async () => {
    try {
      const account = await api.getAccount();
      return textContent(formatAccount(account));
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "update_account",
  {
    title: "Update Account",
    description: "Update your AltText.ai account settings (name, webhook URL, notification email)",
    inputSchema: {
      name: z.string().max(256).optional().describe("Account name"),
      webhook_url: z.string().url().optional().describe("Webhook URL for processing notifications"),
      notification_email: z.string().email().optional().describe("Email address for notifications"),
    },
  },
  async ({ name, webhook_url, notification_email }) => {
    try {
      const account = await api.updateAccount({
        name,
        webhookUrl: webhook_url,
        notificationEmail: notification_email,
      });
      return textContent(`Updated account settings:\n\n${formatAccount(account)}`);
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ============================================================
// Generate Alt Text
// ============================================================

server.registerTool(
  "generate_alt_text",
  {
    title: "Generate Alt Text",
    description:
      "Generate AI-powered alt text for an image URL. Returns the result synchronously (may take a few seconds). Costs 1 credit per image.",
    inputSchema: {
      url: z.string().url().describe("Public URL of the image"),
      ...generationOptionsSchema,
    },
  },
  async ({ url, ...rest }) => {
    try {
      const opts = toGenerateOptions(rest);
      const image = await api.createImage({ url, ...opts });
      return textContent(`Generated alt text for ${url}:\n\n${formatImage(image)}`);
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "generate_alt_text_from_file",
  {
    title: "Generate Alt Text from File",
    description:
      "Generate alt text from a local image file. Reads the file, base64-encodes it, and sends it to AltText.ai. Costs 1 credit.",
    inputSchema: {
      file_path: z.string().max(4096).describe("Absolute path to a local image file"),
      ...generationOptionsSchema,
    },
  },
  async ({ file_path, ...rest }) => {
    try {
      await resolveAndValidateFile(file_path, ALLOWED_IMAGE_EXTENSIONS);
      const raw = (await readFile(file_path)).toString("base64");
      const opts = toGenerateOptions(rest);
      const image = await api.createImageFromRaw({ raw, ...opts });
      return textContent(`Generated alt text for ${basename(file_path)}:\n\n${formatImage(image)}`);
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "translate_image",
  {
    title: "Translate Image",
    description:
      "Add alt text in a new language for an existing image. Uses the asset_id to find the image and generates a translation. Costs 1 credit.",
    inputSchema: {
      asset_id: z.string().max(256).describe("The asset ID of the existing image to translate"),
      lang: z
        .string()
        .max(64)
        .describe("Target language code(s), comma-separated (e.g. 'de', 'fr,es')"),
    },
  },
  async ({ asset_id, lang }) => {
    try {
      const image = await api.translateImage({ assetId: asset_id, lang });
      return textContent(`Translated image ${asset_id} to ${lang}:\n\n${formatImage(image)}`);
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ============================================================
// Image Library Management
// ============================================================

server.registerTool(
  "list_images",
  {
    title: "List Images",
    description: "List images in your AltText.ai library with pagination",
    inputSchema: {
      page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Items per page (default: 20, max: 100)"),
      lang: z.string().max(64).optional().describe("Filter alt texts by language code"),
    },
  },
  async ({ page, limit, lang }) => {
    try {
      const result = await api.listImages({ page, limit, lang });
      return textContent(formatImageList(result));
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "search_images",
  {
    title: "Search Images",
    description: "Search images by alt text content",
    inputSchema: {
      query: z.string().max(256).describe("Search query to match against alt text"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results to return (default: 20)"),
      lang: z.string().max(64).optional().describe("Filter by language code"),
    },
  },
  async ({ query, limit, lang }) => {
    try {
      const result = await api.searchImages({ query, limit, lang });
      return textContent(`Search results for "${query}":\n\n${formatImageList(result)}`);
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "get_image",
  {
    title: "Get Image",
    description: "Get details for a specific image by its asset ID",
    inputSchema: {
      asset_id: z.string().max(256).describe("The asset ID of the image"),
      lang: z.string().max(64).optional().describe("Filter alt texts by language code"),
    },
  },
  async ({ asset_id, lang }) => {
    try {
      const image = await api.getImage({ assetId: asset_id, lang });
      return textContent(formatImage(image));
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "update_image",
  {
    title: "Update Image",
    description: "Update alt text and/or metadata for an existing image",
    inputSchema: {
      asset_id: z.string().max(256).describe("The asset ID of the image to update"),
      alt_text: z.string().max(1000).optional().describe("New alt text value"),
      tags: z.array(z.string().max(128)).max(50).optional().describe("Replace tags"),
      metadata: z
        .record(z.string().max(256))
        .optional()
        .describe("Replace metadata (string key-value pairs)"),
      lang: z
        .string()
        .max(64)
        .optional()
        .describe("Language code for the alt text (default: 'en')"),
      overwrite: z
        .boolean()
        .optional()
        .describe("If false, skip language entries that already exist"),
    },
  },
  async ({ asset_id, alt_text, tags, metadata, lang, overwrite }) => {
    try {
      const image = await api.updateImage({
        assetId: asset_id,
        altText: alt_text,
        tags,
        metadata,
        lang,
        overwrite,
      });
      return textContent(`Updated image ${asset_id}:\n\n${formatImage(image)}`);
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "delete_image",
  {
    title: "Delete Image",
    description: "Delete an image from your AltText.ai library",
    inputSchema: {
      asset_id: z.string().max(256).describe("The asset ID of the image to delete"),
    },
  },
  async ({ asset_id }) => {
    try {
      await api.deleteImage({ assetId: asset_id });
      return textContent(`Deleted image ${asset_id}`);
    } catch (err) {
      return errorContent(err);
    }
  },
);

// ============================================================
// Bulk Operations
// ============================================================

server.registerTool(
  "bulk_create",
  {
    title: "Bulk Create",
    description:
      "Bulk generate alt text for multiple images from a CSV file. CSV should have columns: url (required), asset_id, lang, keywords, tags, metadata (optional).",
    inputSchema: {
      csv_file: z
        .string()
        .max(4096)
        .describe("Path to CSV file with image URLs and optional metadata"),
      email: z.string().email().optional().describe("Email for completion notification"),
    },
  },
  async ({ csv_file, email }) => {
    try {
      await resolveAndValidateFile(csv_file);
      const fileBuffer = await readFile(csv_file);
      const blob = new Blob([fileBuffer], { type: "text/csv" });
      const result = await api.bulkCreate({ csvFile: blob, email });

      const rows = result.rows ?? 0;
      const rowErrors = result.row_errors ?? [];
      const fileError = result.error;

      let responseText = `Bulk import processed ${String(rows)} rows`;
      if (rowErrors.length > 0) responseText += `\n\nErrors:\n${rowErrors.join("\n")}`;
      if (fileError) responseText += `\n\nFile error: ${fileError}`;

      return textContent(responseText);
    } catch (err) {
      return errorContent(err);
    }
  },
);

server.registerTool(
  "scrape_page",
  {
    title: "Scrape Page",
    description:
      "Find images on a web page and queue alt-text generation jobs. Images are processed asynchronously.",
    inputSchema: {
      url: z.string().url().describe("URL of the web page to scrape"),
      html: z
        .string()
        .max(500_000)
        .optional()
        .describe("Optional HTML override (if omitted, server fetches the page)"),
      include_existing: z
        .boolean()
        .optional()
        .describe("Include images that already have alt text"),
      ...scrapeOptionsSchema,
    },
  },
  async ({
    url,
    html,
    include_existing,
    lang,
    keywords,
    negative_keywords,
    gpt_prompt,
    max_chars,
  }) => {
    try {
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
      return textContent(formatScrapeResult(result, url));
    } catch (err) {
      return errorContent(err);
    }
  },
);

// -- Start server --

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AltText.ai MCP Server running on stdio");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error("Fatal error:", message);
  process.exit(1);
});
