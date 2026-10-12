import { z } from "zod";
import { formatImage, formatImageList } from "../formatters.js";
import { change, defineOperation, READ } from "../registry/operation.js";
import { pageLimit } from "../schemas.js";
import { deletedImageSchema, imageListSchema, imageRecordSchema } from "./outputs.js";

export const listImages = defineOperation({
  name: "list_images",
  title: "List Images",
  description: "List images in your AltText.ai library with pagination",
  input: z.object({
    page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
    limit: pageLimit("Items per page (default: 20, max: 100)"),
    lang: z.string().max(64).optional().describe("Filter alt texts by language code"),
    url: z.url().optional().describe("Filter images by exact URL match"),
    sort: z.enum(["id", "created_at", "asset_id"]).optional().describe("Sort column (default: id)"),
    direction: z.enum(["ASC", "DESC"]).optional().describe("Sort direction (default: DESC)"),
  }),
  output: imageListSchema,
  annotations: READ,
  permission: "read",
  localFilesOnly: false,
  command: { noun: "images", verb: "list" },
  async handler(api, { page, limit, lang, url, sort, direction }) {
    const result = await api.listImages({ page, limit, lang, url, sort, direction });
    return { text: formatImageList(result), structured: result };
  },
});

export const searchImages = defineOperation({
  name: "search_images",
  title: "Search Images",
  description: "Search images by alt text content",
  input: z.object({
    query: z.string().max(256).describe("Search query to match against alt text"),
    limit: pageLimit("Max results to return (default: 20)"),
    lang: z.string().max(64).optional().describe("Filter by language code"),
  }),
  output: imageListSchema,
  annotations: READ,
  permission: "read",
  localFilesOnly: false,
  command: { noun: "images", verb: "search" },
  async handler(api, { query, limit, lang }) {
    const result = await api.searchImages({ query, limit, lang });
    return {
      text: `Search results for "${query}":\n\n${formatImageList(result)}`,
      structured: result,
    };
  },
});

export const getImage = defineOperation({
  name: "get_image",
  title: "Get Image",
  description: "Get details for a specific image by its asset ID",
  input: z.object({
    asset_id: z.string().max(256).describe("The asset ID of the image"),
    lang: z.string().max(64).optional().describe("Filter alt texts by language code"),
  }),
  output: imageRecordSchema,
  annotations: READ,
  permission: "read",
  localFilesOnly: false,
  command: { noun: "images", verb: "get" },
  async handler(api, { asset_id, lang }) {
    const image = await api.getImage({ assetId: asset_id, lang });
    return { text: formatImage(image), structured: image };
  },
});

export const updateImage = defineOperation({
  name: "update_image",
  title: "Update Image",
  description: "Update alt text and/or metadata for an existing image",
  input: z.object({
    asset_id: z.string().max(256).describe("The asset ID of the image to update"),
    alt_text: z.string().max(1000).optional().describe("New alt text value"),
    tags: z.array(z.string().max(128)).max(50).optional().describe("Replace tags"),
    metadata: z
      .record(z.string(), z.string().max(256))
      .optional()
      .describe("Replace metadata (string key-value pairs)"),
    lang: z.string().max(64).optional().describe("Language code for the alt text (default: 'en')"),
    overwrite: z
      .boolean()
      .optional()
      .describe("If false, skip language entries that already exist"),
  }),
  output: imageRecordSchema,
  annotations: change({ destructive: true, idempotent: true, openWorld: true }),
  permission: "write",
  localFilesOnly: false,
  command: { noun: "images", verb: "update" },
  async handler(api, { asset_id, alt_text, tags, metadata, lang, overwrite }) {
    const image = await api.updateImage({
      assetId: asset_id,
      altText: alt_text,
      tags,
      metadata,
      lang,
      overwrite,
    });
    return { text: `Updated image ${asset_id}:\n\n${formatImage(image)}`, structured: image };
  },
});

export const deleteImage = defineOperation({
  name: "delete_image",
  title: "Delete Image",
  description: "Delete an image from your AltText.ai library",
  input: z.object({
    asset_id: z.string().max(256).describe("The asset ID of the image to delete"),
  }),
  output: deletedImageSchema,
  annotations: change({ destructive: true, idempotent: true, openWorld: true }),
  permission: "write",
  localFilesOnly: false,
  command: { noun: "images", verb: "delete" },
  async handler(api, { asset_id }) {
    await api.deleteImage({ assetId: asset_id });
    return { text: `Deleted image ${asset_id}`, structured: { asset_id, deleted: true } };
  },
});
