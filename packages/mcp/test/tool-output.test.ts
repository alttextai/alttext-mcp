import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AltTextApi, operations } from "@alttext_ai/core";
import { createServer } from "../src/server.js";

const image = {
  asset_id: "abc",
  alt_text: "A cat",
  url: "https://x.test/cat.jpg",
  alt_texts: { en: "A cat", fr: "Un chat" },
  tags: ["pets"],
  metadata: { sku: "1" },
  created_at: 1700000000,
};
const account = {
  name: "Acme",
  usage: 10,
  usage_limit: 100,
  default_lang: "en",
  webhook_url: "https://hook.test",
  notification_email: "a@b.test",
  whitelabel: false,
  no_quotes: true,
  ending_period: true,
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function respond(url: string, init: RequestInit = {}): Response {
  const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
  const method = init.method ?? "GET";
  if (path === "/account") return json(account);
  if (path === "/images" && method === "GET") {
    return json({ images: [image, { asset_id: "def", alt_text: null }] }, 200, {
      "current-page": "1",
      "page-items": "20",
      "total-pages": "3",
      "total-count": "42",
    });
  }
  if (path === "/images/search") {
    return json({ images: [image] }, 200, {
      "current-page": "1",
      "total-pages": "1",
      "total-count": "1",
    });
  }
  if (path === "/images/bulk_create") return json({ rows: 3, row_errors: ["row 2: bad url"] });
  if (path === "/images/page_scrape") {
    return json({
      scraped_images: [
        { src: "https://x.test/a.png", width: 10, height: 20 },
        { src: "https://x.test/b.png", skip_reason: "has alt" },
      ],
      total_processed: 1,
    });
  }
  if (path === "/images/missing") return json({ error: "Not found", error_code: "not_found" }, 404);
  if (path.startsWith("/images/") && method === "DELETE") return json({});
  return json(image);
}

const imageText = [
  "Asset ID: abc",
  "Alt text: A cat",
  "URL: https://x.test/cat.jpg",
  "Languages:",
  "  en: A cat",
  "  fr: Un chat",
  "Tags: pets",
  'Metadata: {"sku":"1"}',
  "Created: 2023-11-14T22:13:20.000Z",
].join("\n");
const accountText = [
  "Account: Acme",
  "Credits: 90 remaining (10 used of 100)",
  "Default language: en",
  "Webhook: https://hook.test",
  "Notification email: a@b.test",
  "Whitelabel: false",
  "No quotes: true",
  "Ending period: true",
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "alttext-tool-output-"));
const png = join(dir, "cat.png");
const csv = join(dir, "list.csv");
writeFileSync(png, "\x89PNG\r\n");
writeFileSync(csv, "url\nhttps://x.test/a.jpg\n");

const cases: Array<[string, Record<string, unknown>, string, boolean]> = [
  ["get_account", {}, accountText, false],
  ["update_account", { name: "Acme" }, `Updated account settings:\n\n${accountText}`, false],
  [
    "generate_alt_text",
    { url: "https://x.test/cat.jpg", lang: "en,fr" },
    `Generated alt text for https://x.test/cat.jpg:\n\n${imageText}`,
    false,
  ],
  [
    "generate_alt_text_from_file",
    { file_path: png },
    `Generated alt text for cat.png:\n\n${imageText}`,
    false,
  ],
  [
    "generate_alt_text_from_file",
    { file_path: csv },
    "Error: Unsupported file type: .csv. Supported: .jpg, .jpeg, .png, .gif, .webp, .bmp, .tiff, .tif, .svg, .avif",
    true,
  ],
  [
    "translate_image",
    { asset_id: "abc", lang: "fr" },
    `Translated image abc to fr:\n\n${imageText}`,
    false,
  ],
  [
    "list_images",
    { page: 1 },
    "Found 42 images (page 1 of 3)\n\n- abc: A cat\n- def: (no alt text)",
    false,
  ],
  [
    "search_images",
    { query: "cat" },
    'Search results for "cat":\n\nFound 1 images (page 1 of 1)\n\n- abc: A cat',
    false,
  ],
  ["get_image", { asset_id: "abc" }, imageText, false],
  ["get_image", { asset_id: "missing" }, "Error (404): Not found\nCode: not_found", true],
  [
    "update_image",
    { asset_id: "abc", alt_text: "A cat" },
    `Updated image abc:\n\n${imageText}`,
    false,
  ],
  ["delete_image", { asset_id: "abc" }, "Deleted image abc", false],
  [
    "bulk_create",
    { csv_file: csv },
    "CSV import response: 3 rows. Generation runs asynchronously; this response does not confirm completion.\n\nErrors:\nrow 2: bad url",
    false,
  ],
  [
    "scrape_page",
    { url: "https://x.test/" },
    [
      "Scraped https://x.test/",
      "Images found: 2",
      "Images queued for processing: 1",
      "",
      "Discovered images:",
      "  - https://x.test/a.png (10x20) [queued]",
      "  - https://x.test/b.png [skipped: has alt]",
      "",
      "Note: Images are being processed asynchronously. Use list_images or get_image to check results.",
    ].join("\n"),
    false,
  ],
];

const client = new Client({ name: "test", version: "1" });
beforeAll(async () => {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => Promise.resolve(respond(url, init)));
  const server = createServer(new AltTextApi("test-key", "https://api.test/api/v1"));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  vi.unstubAllGlobals();
});

describe("tool output", () => {
  it.each(cases)("%s returns the same text as before", async (name, args, text, isError) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.content).toEqual([{ type: "text", text }]);
    expect(result.isError ?? false).toBe(isError);
  });

  it.each(cases.filter(([, , , isError]) => !isError))(
    "%s returns structured output matching its declared schema",
    async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const operation = operations.find((op) => op.name === name);
      expect(result.structuredContent).toBeDefined();
      expect(operation?.output.safeParse(result.structuredContent).success).toBe(true);
    },
  );
});
