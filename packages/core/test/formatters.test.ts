import { describe, it, expect } from "vitest";
import {
  formatImage,
  formatImageList,
  formatAccount,
  formatScrapeResult,
} from "../src/formatters.js";
import type { AccountRecord, ImageListResult, ImageRecord, ScrapeResult } from "../src/types.js";

describe("formatImage", () => {
  it("formats a complete image", () => {
    const image: ImageRecord = {
      asset_id: "abc123",
      alt_text: "A red bicycle",
      url: "https://example.com/bike.jpg",
      alt_texts: { en: "A red bicycle", fr: "Un velo rouge" },
      tags: ["product", "bicycle"],
      metadata: { source: "upload" },
      created_at: 1_700_000_000,
    };
    const result = formatImage(image);
    expect(result).toContain("Asset ID: abc123");
    expect(result).toContain("Alt text: A red bicycle");
    expect(result).toContain("URL: https://example.com/bike.jpg");
    expect(result).toContain("Languages:");
    expect(result).toContain("en: A red bicycle");
    expect(result).toContain("fr: Un velo rouge");
    expect(result).toContain("Tags: product, bicycle");
    expect(result).toContain('Metadata: {"source":"upload"}');
    expect(result).toContain("Created: 2023-11-14T22:13:20.000Z");
  });

  it("shows (none) for missing alt text", () => {
    const image: ImageRecord = { asset_id: "xyz", alt_text: null };
    const result = formatImage(image);
    expect(result).toContain("Alt text: (none)");
  });

  it("omits URL when not present", () => {
    const image: ImageRecord = { asset_id: "xyz", alt_text: "test" };
    expect(formatImage(image)).not.toContain("URL:");
  });

  it("omits languages when empty", () => {
    const image: ImageRecord = { asset_id: "xyz", alt_text: "test" };
    expect(formatImage(image)).not.toContain("Languages:");
  });

  it("includes error messages", () => {
    const image: ImageRecord = {
      asset_id: "err1",
      alt_text: null,
      errors: { url: ["is unreachable"] },
    };
    expect(formatImage(image)).toContain("Errors: is unreachable");
  });

  it("includes error_code when present", () => {
    const image: ImageRecord = {
      asset_id: "err2",
      alt_text: null,
      error_code: "download_failed",
      errors: { url: ["could not download"] },
    };
    const result = formatImage(image);
    expect(result).toContain("Error code: download_failed");
    expect(result).toContain("Errors: could not download");
  });
});

describe("formatImageList", () => {
  it("shows pagination summary and images", () => {
    const result: ImageListResult = {
      images: [
        { asset_id: "img1", alt_text: "First image" },
        { asset_id: "img2", alt_text: null },
      ],
      pagination: { currentPage: 1, pageItems: 20, totalPages: 3, totalCount: 25 },
    };
    const output = formatImageList(result);
    expect(output).toContain("Found 25 images (page 1 of 3)");
    expect(output).toContain("- img1: First image");
    expect(output).toContain("- img2: (no alt text)");
  });

  it("shows no images message when empty", () => {
    const result: ImageListResult = {
      images: [],
      pagination: { currentPage: 1, pageItems: 20, totalPages: 1, totalCount: 0 },
    };
    expect(formatImageList(result)).toContain("No images found.");
  });
});

describe("formatAccount", () => {
  it("formats a complete account", () => {
    const account: AccountRecord = {
      name: "Test Account",
      usage: 42,
      usage_limit: 1000,
      default_lang: "en",
      gpt_prompt: "Describe this image",
      max_chars: 125,
      webhook_url: "https://example.com/hook",
      notification_email: "test@example.com",
      whitelabel: false,
      no_quotes: true,
      ending_period: true,
    };
    const result = formatAccount(account);
    expect(result).toContain("Credits: 958 remaining (42 used of 1000)");
    expect(result).toContain("Account: Test Account");
    expect(result).toContain("Default language: en");
    expect(result).toContain("Custom prompt: Describe this image");
    expect(result).toContain("Max chars: 125");
    expect(result).toContain("Webhook: https://example.com/hook");
    expect(result).toContain("Notification email: test@example.com");
    expect(result).toContain("Ending period: true");
    expect(result).not.toContain("Remove symbols:");
  });

  it("includes remove_symbols when true", () => {
    const account: AccountRecord = {
      name: "Symbols",
      usage: 0,
      usage_limit: 100,
      default_lang: "en",
      whitelabel: false,
      no_quotes: false,
      remove_symbols: true,
    };
    expect(formatAccount(account)).toContain("Remove symbols: true");
  });

  it("omits optional fields when absent", () => {
    const account: AccountRecord = {
      name: "Basic",
      usage: 0,
      usage_limit: 100,
      default_lang: "en",
      whitelabel: false,
      no_quotes: false,
    };
    const result = formatAccount(account);
    expect(result).not.toContain("Custom prompt:");
    expect(result).not.toContain("Max chars:");
    expect(result).not.toContain("Webhook:");
    expect(result).not.toContain("Notification email:");
    expect(result).not.toContain("Ending period:");
  });
});

describe("formatScrapeResult", () => {
  it("formats queued and skipped images", () => {
    const result: ScrapeResult = {
      scraped_images: [{ src: "img1.jpg" }, { src: "img2.jpg", skip_reason: "already processed" }],
      total_processed: 1,
    };
    const output = formatScrapeResult(result, "https://example.com/page");
    expect(output).toContain("Scraped https://example.com/page");
    expect(output).toContain("Images found: 2");
    expect(output).toContain("Images queued for processing: 1");
    expect(output).toContain("- img1.jpg [queued]");
    expect(output).toContain("- img2.jpg [skipped: already processed]");
    expect(output).toContain("Images are being processed asynchronously");
  });

  it("includes image dimensions when available", () => {
    const result: ScrapeResult = {
      scraped_images: [{ src: "img1.jpg", width: 800, height: 600 }],
      total_processed: 1,
    };
    const output = formatScrapeResult(result, "https://example.com/page");
    expect(output).toContain("- img1.jpg (800x600) [queued]");
  });

  it("shows zero counts with no images", () => {
    const result: ScrapeResult = { scraped_images: [], total_processed: 0 };
    const output = formatScrapeResult(result, "https://example.com/page");
    expect(output).toContain("Images found: 0");
    expect(output).toContain("Images queued for processing: 0");
    expect(output).not.toContain("asynchronously");
  });

  it("includes error messages", () => {
    const result: ScrapeResult = {
      scraped_images: [],
      total_processed: 0,
      errors: { url: ["is unreachable"] },
    };
    expect(formatScrapeResult(result, "https://example.com")).toContain("Errors: is unreachable");
  });
});
