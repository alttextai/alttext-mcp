import { readFile } from "node:fs/promises";
import { z } from "zod";
import { defineOperation } from "../registry/operation.js";
import { resolveAndValidateFile } from "./files.js";
import { bulkCreateResultSchema } from "./outputs.js";

export const bulkCreate = defineOperation({
  name: "bulk_create",
  title: "Bulk Create",
  description:
    "Upload a local CSV file from the MCP server machine and queue asynchronous alt-text generation using account credits. The response does not confirm generation completion. CSV should have columns: url (required), asset_id, lang, keywords, tags, metadata (optional).",
  input: z.object({
    csv_file: z
      .string()
      .max(4096)
      .describe("Path to CSV file with image URLs and optional metadata"),
    email: z.email().optional().describe("Email for completion notification"),
  }),
  output: bulkCreateResultSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  permission: "write",
  localFilesOnly: true,
  command: { noun: "images", verb: "bulk-create" },
  async handler(api, { csv_file, email }) {
    const resolved = await resolveAndValidateFile(csv_file);
    const fileBuffer = await readFile(resolved);
    const blob = new Blob([fileBuffer], { type: "text/csv" });
    const result = await api.bulkCreate({ csvFile: blob, email });

    const rows = result.rows ?? 0;
    const rowErrors = result.row_errors ?? [];
    const fileError = result.error;

    let text = `CSV import response: ${String(rows)} rows. Generation runs asynchronously; this response does not confirm completion.`;
    if (rowErrors.length > 0) text += `\n\nErrors:\n${rowErrors.join("\n")}`;
    if (fileError) text += `\n\nFile error: ${fileError}`;

    return { text, structured: result };
  },
});
