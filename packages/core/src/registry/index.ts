import { getAccount, updateAccount } from "../operations/account.js";
import {
  createApiKey,
  getApiKey,
  listApiKeyHistory,
  listApiKeys,
  revealApiKeyToken,
  revokeApiKey,
  rotateApiKey,
  updateApiKey,
} from "../operations/api-keys.js";
import { bulkCreate } from "../operations/bulk-create.js";
import {
  generateAltText,
  generateAltTextFromFile,
  translateImage,
} from "../operations/generate.js";
import {
  deleteImage,
  getImage,
  listImages,
  searchImages,
  updateImage,
} from "../operations/images.js";
import { scrapePage } from "../operations/scrape-page.js";
import type { Operation } from "./operation.js";

export {
  defineOperation,
  operationJsonSchemas,
  runOperation,
  type Operation,
  type OperationAnnotations,
  type OperationResult,
  type Permission,
} from "./operation.js";

/** in the order MCP clients list them */
export const operations: readonly Operation[] = [
  getAccount,
  updateAccount,
  generateAltText,
  generateAltTextFromFile,
  translateImage,
  listImages,
  searchImages,
  getImage,
  updateImage,
  deleteImage,
  bulkCreate,
  scrapePage,
  listApiKeys,
  getApiKey,
  revealApiKeyToken,
  createApiKey,
  updateApiKey,
  rotateApiKey,
  revokeApiKey,
  listApiKeyHistory,
];

export function isKeyOperation(operation: Operation): boolean {
  return operation.permission === "keys_read" || operation.permission === "keys_write";
}

export interface SurfaceOptions {
  readonly localFiles?: boolean;
  readonly keys?: boolean;
}

/** local-file operations need the same machine, and key operations need the surface to opt in */
export function availableOperations(options: SurfaceOptions = {}): readonly Operation[] {
  return operations.filter(
    (operation) =>
      (options.localFiles !== false || !operation.localFilesOnly) &&
      (options.keys === true || !isKeyOperation(operation)),
  );
}
