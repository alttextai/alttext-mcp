import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { AltTextApi, AltTextApiError } from "../src/alttext-api.js";

const BASE_URL = "https://alttext.ai/api/v1";
const API_KEY = "test-api-key-123";

let api: AltTextApi;
let fetchMock: Mock;

function jsonResponse(
  body: unknown,
  opts: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = opts.status ?? 200;
  const headers = new Headers({
    "Content-Type": "application/json",
    ...opts.headers,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  api = new AltTextApi(API_KEY);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("AltTextApi", () => {
  describe("getAccount", () => {
    it("returns parsed account data", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ name: "Test Account", usage: 42, usage_limit: 1000 }),
      );
      const result = await api.getAccount();
      expect(result).toEqual({ name: "Test Account", usage: 42, usage_limit: 1000 });
    });

    it("sends the API key header", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: "Test" }));
      await api.getAccount();
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/account`,
        expect.objectContaining({
          headers: expect.objectContaining({ "X-API-Key": API_KEY }) as unknown,
        }),
      );
    });

    it("sends the X-Client header with version", async () => {
      const apiWithVersion = new AltTextApi(API_KEY, undefined, "1.0.0");
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: "Test" }));
      await apiWithVersion.getAccount();
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/account`,
        expect.objectContaining({
          headers: expect.objectContaining({ "X-Client": "mcp-server/1.0.0" }) as unknown,
        }),
      );
    });
  });

  describe("createImage", () => {
    const imageUrl = "https://example.com/photo.jpg";

    it("returns image data with alt text", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ asset_id: "abc123", alt_text: "A photo", url: imageUrl }),
      );
      const result = await api.createImage({ url: imageUrl });
      expect(result).toMatchObject({ asset_id: "abc123", alt_text: "A photo" });
    });

    it("sends async: false in the request body", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "abc123" }));
      await api.createImage({ url: imageUrl });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({ image: { url: imageUrl }, async: false });
    });

    it("includes all optional parameters in the request body", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "abc123" }));
      await api.createImage({
        url: imageUrl,
        lang: "en,fr",
        keywords: ["product"],
        overwrite: false,
        tags: ["hero"],
        metadata: { source: "test" },
      });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["lang"]).toBe("en,fr");
      expect(body["keywords"]).toEqual(["product"]);
      expect(body["overwrite"]).toBe(false);
      expect((body["image"] as Record<string, unknown>)["tags"]).toEqual(["hero"]);
      expect((body["image"] as Record<string, unknown>)["metadata"]).toEqual({ source: "test" });
    });

    it("sends overwrite: false (not omitted)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "abc123" }));
      await api.createImage({ url: imageUrl, overwrite: false });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["overwrite"]).toBe(false);
    });
  });

  describe("createImageFromRaw", () => {
    const rawData = Buffer.from("fake-image-bytes").toString("base64");

    it("returns image data", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ asset_id: "raw123", alt_text: "A raw image" }),
      );
      const result = await api.createImageFromRaw({ raw: rawData });
      expect(result).toMatchObject({ asset_id: "raw123", alt_text: "A raw image" });
    });

    it("sends raw in the image envelope", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "raw123" }));
      await api.createImageFromRaw({ raw: rawData });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({ image: { raw: rawData }, async: false });
    });

    it("includes optional parameters", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "raw123" }));
      await api.createImageFromRaw({
        raw: rawData,
        lang: "en",
        keywords: ["photo"],
        tags: ["uploaded"],
      });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["lang"]).toBe("en");
      expect(body["keywords"]).toEqual(["photo"]);
      expect((body["image"] as Record<string, unknown>)["tags"]).toEqual(["uploaded"]);
    });
  });

  describe("listImages", () => {
    it("returns images with pagination metadata", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { images: [{ asset_id: "img1" }] },
          {
            headers: {
              "current-page": "2",
              "page-items": "10",
              "total-pages": "5",
              "total-count": "47",
            },
          },
        ),
      );
      const result = await api.listImages({ page: 2 });
      expect(result.images).toEqual([{ asset_id: "img1" }]);
      expect(result.pagination).toEqual({
        currentPage: 2,
        pageItems: 10,
        totalPages: 5,
        totalCount: 47,
      });
    });

    it("returns sensible defaults when headers are missing", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ images: [] }));
      const result = await api.listImages();
      expect(result.pagination).toEqual({
        currentPage: 1,
        pageItems: 20,
        totalPages: 1,
        totalCount: 0,
      });
    });

    it("passes url, sort, and direction as query params", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ images: [] }));
      await api.listImages({
        url: "https://example.com/photo.jpg",
        sort: "created_at",
        direction: "ASC",
      });

      const [requestUrl] = fetchMock.mock.calls[0] as [string];
      expect(requestUrl).toContain("url=https");
      expect(requestUrl).toContain("sort=created_at");
      expect(requestUrl).toContain("direction=ASC");
    });
  });

  describe("searchImages", () => {
    it("sends query as q parameter", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { images: [{ asset_id: "sun1", alt_text: "A sunset" }] },
          {
            headers: { "current-page": "1", "total-pages": "1", "total-count": "1" },
          },
        ),
      );
      await api.searchImages({ query: "sunset" });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("q=sunset");
    });

    it("returns matching images", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { images: [{ asset_id: "sun1", alt_text: "A sunset" }] },
          {
            headers: { "total-count": "1" },
          },
        ),
      );
      const result = await api.searchImages({ query: "sunset" });
      expect(result.images[0]?.alt_text).toBe("A sunset");
    });
  });

  describe("getImage", () => {
    it("returns image details", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "abc123", alt_text: "Test image" }));
      const result = await api.getImage({ assetId: "abc123" });
      expect(result).toMatchObject({ asset_id: "abc123", alt_text: "Test image" });
    });

    it("URL-encodes the asset_id in the path", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "shp-123/456" }));
      await api.getImage({ assetId: "shp-123/456" });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("/images/shp-123%2F456");
    });
  });

  describe("updateAccount", () => {
    it("returns updated account data", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ name: "New Name", webhook_url: "https://example.com/webhook" }),
      );
      const result = await api.updateAccount({
        name: "New Name",
        webhookUrl: "https://example.com/webhook",
      });
      expect(result).toMatchObject({ name: "New Name" });
    });

    it("sends PATCH with account envelope", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: "New Name" }));
      await api.updateAccount({ name: "New Name" });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["account"]).toMatchObject({ name: "New Name" });
    });

    it("only sends provided fields", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await api.updateAccount({ notificationEmail: "test@example.com" });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      const account = body["account"] as Record<string, unknown>;
      expect(account).toHaveProperty("notification_email");
      expect(account).not.toHaveProperty("name");
    });
  });

  describe("translateImage", () => {
    it("returns image data with translations", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          asset_id: "abc123",
          alt_texts: [
            { lang: "en", alt_text: "A photo" },
            { lang: "de", alt_text: "Ein Foto" },
          ],
        }),
      );
      const result = await api.translateImage({ assetId: "abc123", lang: "de" });
      expect(result.alt_texts).toBeDefined();
    });

    it("sends asset_id and lang without a URL", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ asset_id: "abc123" }));
      await api.translateImage({ assetId: "abc123", lang: "de" });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body).toEqual({
        image: { asset_id: "abc123" },
        lang: "de",
        async: false,
      });
    });
  });

  describe("updateImage", () => {
    it("sends PATCH with alt_text in image envelope", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ asset_id: "abc123", alt_text: "Updated text" }),
      );
      await api.updateImage({ assetId: "abc123", altText: "Updated text" });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["image"]).toMatchObject({ alt_text: "Updated text" });
    });
  });

  describe("deleteImage", () => {
    it("sends DELETE request", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await api.deleteImage({ assetId: "abc123" });

      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/images/abc123");
      expect(opts.method).toBe("DELETE");
    });
  });

  describe("bulkCreate", () => {
    it("returns bulk import results", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, rows: 2, row_errors: [], error: null }),
      );
      const csvBlob = new Blob(["url\nhttps://example.com/img1.jpg"], { type: "text/csv" });
      const result = await api.bulkCreate({ csvFile: csvBlob, email: "test@example.com" });
      expect(result.rows).toBe(2);
    });
  });

  describe("scrapePage", () => {
    const pageUrl = "https://example.com/page";

    it("returns scrape results", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ scraped_images: [{ src: "img1.jpg" }], total_processed: 1 }),
      );
      const result = await api.scrapePage({ url: pageUrl });
      expect(result.total_processed).toBe(1);
      expect(result.scraped_images.length).toBe(1);
    });

    it("sends URL in page_scrape envelope", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scraped_images: [], total_processed: 0 }));
      await api.scrapePage({ url: pageUrl });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["page_scrape"]).toMatchObject({ url: pageUrl });
    });

    it("includes all optional parameters", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ scraped_images: [], total_processed: 0 }));
      await api.scrapePage({
        url: pageUrl,
        lang: "en,fr",
        keywords: ["product"],
        negativeKeywords: ["logo"],
        gptPrompt: "Custom prompt",
        maxChars: 120,
        overwrite: true,
      });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body["lang"]).toBe("en,fr");
      expect(body["keywords"]).toEqual(["product"]);
      expect(body["negative_keywords"]).toEqual(["logo"]);
      expect(body["gpt_prompt"]).toBe("Custom prompt");
      expect(body["max_chars"]).toBe(120);
      expect(body["overwrite"]).toBe(true);
    });
  });

  describe("error handling", () => {
    it("raises AltTextApiError with status and error_code on 401", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Invalid API key", error_code: "unauthorized" }, { status: 401 }),
      );
      try {
        await api.getAccount();
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AltTextApiError);
        const apiErr = err as AltTextApiError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.errorCode).toBe("unauthorized");
        expect(apiErr.message).toBe("Invalid API key");
      }
    });

    it("raises AltTextApiError with validation errors on 422", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ errors: { url: ["is invalid", "must be public"] } }, { status: 422 }),
      );
      try {
        await api.createImage({ url: "bad" });
        expect.fail("should have thrown");
      } catch (err) {
        const apiErr = err as AltTextApiError;
        expect(apiErr.status).toBe(422);
        expect(apiErr.errors).toEqual({ url: ["is invalid", "must be public"] });
        expect(apiErr.message).toBe("is invalid, must be public");
      }
    });

    it("raises AltTextApiError on 429 rate limit", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Rate limit exceeded" }, { status: 429 }),
      );
      try {
        await api.getAccount();
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as AltTextApiError).status).toBe(429);
      }
    });

    it("handles non-JSON error body", async () => {
      fetchMock.mockResolvedValueOnce(new Response("<html>Bad Gateway</html>", { status: 502 }));
      try {
        await api.getAccount();
        expect.fail("should have thrown");
      } catch (err) {
        const apiErr = err as AltTextApiError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.message).toBe("HTTP 502");
      }
    });

    it("raises connection_error on fetch failure", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Connection refused"));
      try {
        await api.getAccount();
        expect.fail("should have thrown");
      } catch (err) {
        const apiErr = err as AltTextApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.errorCode).toBe("connection_error");
        expect(apiErr.message).toContain("Connection refused");
      }
    });

    it("raises connection_error on timeout", async () => {
      fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"));
      try {
        await api.getAccount();
        expect.fail("should have thrown");
      } catch (err) {
        const apiErr = err as AltTextApiError;
        expect(apiErr.errorCode).toBe("connection_error");
      }
    });
  });

  describe("custom base URL", () => {
    it("uses the custom base URL", async () => {
      const customApi = new AltTextApi(API_KEY, "https://staging.alttext.ai/api/v1");
      fetchMock.mockResolvedValueOnce(jsonResponse({ name: "Staging" }));
      const result = await customApi.getAccount();
      expect(result.name).toBe("Staging");

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("staging.alttext.ai");
    });
  });
});
