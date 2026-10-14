import { realpath, stat } from "node:fs/promises";
import { extname } from "node:path";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
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

export async function resolveAndValidateFile(
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
