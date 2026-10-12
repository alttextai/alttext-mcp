import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { formatImage } from "../formatters.js";
import { defineOperation } from "../registry/operation.js";
import { generationOptionsSchema } from "../schemas.js";
import type { GenerateOptions } from "../types.js";
import { ALLOWED_IMAGE_EXTENSIONS, resolveAndValidateFile } from "./files.js";
import { imageRecordSchema } from "./outputs.js";

/** Snake_case tool arg → camelCase GenerateOptions key. */
const GENERATE_OPTION_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["asset_id", "assetId"],
  ["lang", "lang"],
  ["keywords", "keywords"],
  ["negative_keywords", "negativeKeywords"],
  ["gpt_prompt", "gptPrompt"],
  ["max_chars", "maxChars"],
  ["overwrite", "overwrite"],
  ["tags", "tags"],
  ["metadata", "metadata"],
];

function toGenerateOptions(args: Record<string, unknown>): GenerateOptions {
  const opts: Record<string, unknown> = {};
  for (const [snakeKey, camelKey] of GENERATE_OPTION_KEYS) {
    if (args[snakeKey] !== undefined) {
      opts[camelKey] = args[snakeKey];
    }
  }
  return opts as GenerateOptions;
}

export const generateAltText = defineOperation({
  name: "generate_alt_text",
  title: "Generate Alt Text",
  description:
    "Generate AI-powered alt text for an image URL. Returns the result synchronously (may take a few seconds). Uses account credits; additional languages and image conversion can increase the total. Can overwrite existing alt text when requested.",
  input: z.object({
    url: z.url().describe("Public URL of the image"),
    ...generationOptionsSchema,
  }),
  output: imageRecordSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  permission: "write",
  localFilesOnly: false,
  command: { noun: "images", verb: "generate" },
  async handler(api, { url, ...rest }) {
    const image = await api.createImage({ url, ...toGenerateOptions(rest) });
    return { text: `Generated alt text for ${url}:\n\n${formatImage(image)}`, structured: image };
  },
});

export const generateAltTextFromFile = defineOperation({
  name: "generate_alt_text_from_file",
  title: "Generate Alt Text from File",
  description:
    "Generate alt text from a local image file. Reads a file on the MCP server machine and uploads it to AltText.ai. Uses account credits; additional languages and image conversion can increase the total. Can overwrite existing alt text when requested.",
  input: z.object({
    file_path: z.string().max(4096).describe("Absolute path to a local image file"),
    ...generationOptionsSchema,
  }),
  output: imageRecordSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  permission: "write",
  localFilesOnly: true,
  command: { noun: "images", verb: "generate-from-file" },
  async handler(api, { file_path, ...rest }) {
    const resolved = await resolveAndValidateFile(file_path, ALLOWED_IMAGE_EXTENSIONS);
    const raw = (await readFile(resolved)).toString("base64");
    const image = await api.createImageFromRaw({ raw, ...toGenerateOptions(rest) });
    return {
      text: `Generated alt text for ${basename(file_path)}:\n\n${formatImage(image)}`,
      structured: image,
    };
  },
});

export const translateImage = defineOperation({
  name: "translate_image",
  title: "Translate Image",
  description:
    "Add alt text in a new language for an existing image. Uses the asset_id to find the image and generates a translation. Uses account credits for each newly generated language.",
  input: z.object({
    asset_id: z.string().max(256).describe("The asset ID of the existing image to translate"),
    lang: z
      .string()
      .max(64)
      .describe("Target language code(s), comma-separated (e.g. 'de', 'fr,es')"),
  }),
  output: imageRecordSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  permission: "write",
  localFilesOnly: false,
  command: { noun: "images", verb: "translate" },
  async handler(api, { asset_id, lang }) {
    const image = await api.translateImage({ assetId: asset_id, lang });
    return {
      text: `Translated image ${asset_id} to ${lang}:\n\n${formatImage(image)}`,
      structured: image,
    };
  },
});
