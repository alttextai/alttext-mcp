import { getAccount, updateAccount } from "../operations/account.js";
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

/** Every operation, in the order MCP clients list them. */
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
];

/** Operations available on a surface; local-file operations need files on the same machine. */
export function availableOperations(options: { localFiles?: boolean } = {}): readonly Operation[] {
  return options.localFiles === false
    ? operations.filter((operation) => !operation.localFilesOnly)
    : operations;
}
