import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AltTextApi, operations, runOperation, type Operation } from "../src/index.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function operation(name: string): Operation {
  const found = operations.find((item) => item.name === name);
  if (!found) throw new Error(`No operation ${name}`);
  return found;
}

function respondWith(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(json(body))),
  );
}

// shaped like Account#as_json and the openapi.yml GET /account example
const account = {
  name: "XYZ Corp",
  webhook_url: "https://my.domain.com/webhooks/alttextai",
  notification_email: "alerts@xyzcorp.com",
  usage: 23,
  usage_limit: 100,
  whitelabel: false,
  default_lang: "en",
  ending_period: true,
  no_quotes: false,
  remove_symbols: ["#", "%"],
  gpt_prompt: null,
  max_chars: 200,
  subscription: {
    plan_name: "Bronze Plan (Monthly)",
    usage_quota: 100,
    status: "active",
    expires_at: "2023-01-23T13:48:07.465Z",
  },
  api_key: { kind: "full_access", can_manage_keys: true, name: "Reseller", origin: "dashboard" },
  errors: {},
};

const api = new AltTextApi("test-key");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account output", () => {
  it("accepts the symbol list the server stores in remove_symbols", async () => {
    respondWith(account);
    const { text, structured } = await runOperation(operation("get_account"), api, {});
    expect(structured["remove_symbols"]).toEqual(["#", "%"]);
    expect(text).toContain("Remove symbols: # %");
  });

  it("accepts a null remove_symbols from an update", async () => {
    respondWith({ ...account, remove_symbols: null, subscription: null });
    const { text, structured } = await runOperation(operation("update_account"), api, {
      name: "XYZ Corp",
    });
    expect(structured["remove_symbols"]).toBeNull();
    expect(text).not.toContain("Remove symbols");
  });
});

describe("bulk_create output", () => {
  it("accepts [row, message] row errors and shows each as its row", async () => {
    const csv = join(mkdtempSync(join(tmpdir(), "alttext-outputs-")), "list.csv");
    writeFileSync(csv, "url\nhttps://x.test/a.jpg\n");
    respondWith({ success: true, rows: 23, row_errors: [[2, "Invalid URL"]], error: null });
    const { text, structured } = await runOperation(operation("bulk_create"), api, {
      csv_file: csv,
    });
    expect(structured["row_errors"]).toEqual([[2, "Invalid URL"]]);
    expect(text).toContain("\n\nErrors:\nRow 2: Invalid URL");
  });
});

describe("scrape_page output", () => {
  it("accepts the raw width and height attribute strings PageScraper returns", async () => {
    respondWith({
      url: "https://x.test/gallery.html",
      scraped_images: [
        { src: "https://x.test/a.png", alt: null, width: "300", height: "200", skip_reason: null },
        {
          src: "https://x.test/b.png",
          alt: "A moth",
          width: null,
          height: null,
          skip_reason: "Alt text already exists",
        },
      ],
      total_processed: 1,
      errors: {},
    });
    const { text, structured } = await runOperation(operation("scrape_page"), api, {
      url: "https://x.test/gallery.html",
    });
    expect(structured["scraped_images"]).toHaveLength(2);
    expect(text).toContain("  - https://x.test/a.png (300x200) [queued]");
    expect(text).toContain("  - https://x.test/b.png [skipped: Alt text already exists]");
  });
});
