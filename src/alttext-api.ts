import type {
  AccountRecord,
  BulkCreateResult,
  GenerateOptions,
  ImageListResult,
  ImageRecord,
  Pagination,
  ScrapePageOptions,
  ScrapeResult,
  UpdateAccountOptions,
  UpdateImageOptions,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 120_000;

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Structured error from the AltText.ai API. */
export class AltTextApiError extends Error {
  readonly status: number;
  readonly errorCode: string | null;
  readonly errors: Readonly<Record<string, readonly string[]>>;

  constructor(opts: {
    status: number;
    errorCode: string | null;
    errors: Record<string, string[]>;
    message: string;
  }) {
    super(opts.message);
    this.name = "AltTextApiError";
    this.status = opts.status;
    this.errorCode = opts.errorCode;
    this.errors = opts.errors;
  }
}

/** HTTP client for the AltText.ai REST API. */
export class AltTextApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl ?? "https://alttext.ai/api/v1").replace(/\/+$/, "");
  }

  async getAccount(): Promise<AccountRecord> {
    const { data } = await this.request("GET", "/account");
    return data as unknown as AccountRecord;
  }

  async updateAccount(opts: UpdateAccountOptions): Promise<AccountRecord> {
    const envelope: Record<string, unknown> = {};
    if (opts.name !== undefined) envelope["name"] = opts.name;
    if (opts.webhookUrl !== undefined) envelope["webhook_url"] = opts.webhookUrl;
    if (opts.notificationEmail !== undefined)
      envelope["notification_email"] = opts.notificationEmail;

    const { data } = await this.request("PATCH", "/account", {
      body: { account: envelope },
    });
    return data as unknown as AccountRecord;
  }

  async listImages(
    opts: { page?: number; limit?: number; lang?: string } = {},
  ): Promise<ImageListResult> {
    const query = this.buildQuery({
      page: opts.page,
      limit: opts.limit,
      lang: opts.lang,
    });

    const { data, response } = await this.request("GET", "/images", { query });
    const typed = data as unknown as { images: ImageRecord[] };
    return {
      images: typed.images,
      pagination: parsePagination(response),
    };
  }

  async searchImages(opts: {
    query: string;
    limit?: number;
    lang?: string;
  }): Promise<ImageListResult> {
    const query = this.buildQuery({
      q: opts.query,
      limit: opts.limit,
      lang: opts.lang,
    });

    const { data, response } = await this.request("GET", "/images/search", { query });
    const typed = data as unknown as { images: ImageRecord[] };
    return {
      images: typed.images,
      pagination: parsePagination(response),
    };
  }

  async getImage(opts: { assetId: string; lang?: string }): Promise<ImageRecord> {
    const query = this.buildQuery({ lang: opts.lang });
    const { data } = await this.request("GET", `/images/${encodeURIComponent(opts.assetId)}`, {
      query,
    });
    return data as unknown as ImageRecord;
  }

  async createImage(opts: { url: string } & GenerateOptions): Promise<ImageRecord> {
    return this.generateImage({ url: opts.url }, opts);
  }

  async createImageFromRaw(opts: { raw: string } & GenerateOptions): Promise<ImageRecord> {
    return this.generateImage({ raw: opts.raw }, opts);
  }

  async translateImage(opts: { assetId: string; lang: string }): Promise<ImageRecord> {
    const body = {
      image: { asset_id: opts.assetId },
      lang: opts.lang,
      async: false,
    };
    const { data } = await this.request("POST", "/images", { body });
    return data as unknown as ImageRecord;
  }

  async updateImage(opts: UpdateImageOptions): Promise<ImageRecord> {
    const imageEnvelope: Record<string, unknown> = {};
    if (opts.altText !== undefined) imageEnvelope["alt_text"] = opts.altText;
    if (opts.tags !== undefined) imageEnvelope["tags"] = opts.tags;
    if (opts.metadata !== undefined) imageEnvelope["metadata"] = opts.metadata;

    const body: Record<string, unknown> = { image: imageEnvelope };
    if (opts.lang !== undefined) body["lang"] = opts.lang;
    if (opts.overwrite !== undefined) body["overwrite"] = opts.overwrite;

    const { data } = await this.request("PATCH", `/images/${encodeURIComponent(opts.assetId)}`, {
      body,
    });
    return data as unknown as ImageRecord;
  }

  async deleteImage(opts: { assetId: string }): Promise<void> {
    await this.request("DELETE", `/images/${encodeURIComponent(opts.assetId)}`);
  }

  async bulkCreate(opts: { csvFile: Blob; email?: string }): Promise<BulkCreateResult> {
    const formData = new FormData();
    formData.append("file", opts.csvFile);
    if (opts.email) formData.append("email", opts.email);

    const url = `${this.baseUrl}/images/bulk_create`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "X-API-Key": this.apiKey, Accept: "application/json" },
        body: formData,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw connectionError(err);
    }

    return handleResponse(response) as Promise<BulkCreateResult>;
  }

  async scrapePage(opts: ScrapePageOptions): Promise<ScrapeResult> {
    const pageScrapeEnvelope: Record<string, unknown> = { url: opts.url };
    if (opts.html !== undefined) pageScrapeEnvelope["html"] = opts.html;

    const body: Record<string, unknown> = { page_scrape: pageScrapeEnvelope };
    if (opts.includeExisting !== undefined) body["include_existing"] = opts.includeExisting;
    if (opts.lang !== undefined) body["lang"] = opts.lang;
    if (opts.keywords !== undefined) body["keywords"] = opts.keywords;
    if (opts.negativeKeywords !== undefined) body["negative_keywords"] = opts.negativeKeywords;
    if (opts.gptPrompt !== undefined) body["gpt_prompt"] = opts.gptPrompt;
    if (opts.maxChars !== undefined) body["max_chars"] = opts.maxChars;
    if (opts.overwrite !== undefined) body["overwrite"] = opts.overwrite;

    const { data } = await this.request("POST", "/images/page_scrape", { body });
    return data as unknown as ScrapeResult;
  }

  // -- Private helpers --

  private async generateImage(
    imageSource: Record<string, unknown>,
    opts: GenerateOptions,
  ): Promise<ImageRecord> {
    const imageEnvelope = { ...imageSource };
    if (opts.assetId !== undefined) imageEnvelope["asset_id"] = opts.assetId;
    if (opts.tags !== undefined) imageEnvelope["tags"] = opts.tags;
    if (opts.metadata !== undefined) imageEnvelope["metadata"] = opts.metadata;

    const body: Record<string, unknown> = { image: imageEnvelope, async: false };
    if (opts.lang !== undefined) body["lang"] = opts.lang;
    if (opts.keywords !== undefined) body["keywords"] = opts.keywords;
    if (opts.negativeKeywords !== undefined) body["negative_keywords"] = opts.negativeKeywords;
    if (opts.gptPrompt !== undefined) body["gpt_prompt"] = opts.gptPrompt;
    if (opts.maxChars !== undefined) body["max_chars"] = opts.maxChars;
    if (opts.overwrite !== undefined) body["overwrite"] = opts.overwrite;

    const { data } = await this.request("POST", "/images", { body });
    return data as unknown as ImageRecord;
  }

  private async request(
    method: HttpMethod,
    path: string,
    opts: { body?: Record<string, unknown>; query?: Record<string, string> } = {},
  ): Promise<{ data: Record<string, unknown>; response: Response }> {
    let url = `${this.baseUrl}${path}`;
    if (opts.query && Object.keys(opts.query).length > 0) {
      url += `?${new URLSearchParams(opts.query).toString()}`;
    }

    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      Accept: "application/json",
    };

    const fetchOpts: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };

    if (opts.body) {
      headers["Content-Type"] = "application/json";
      fetchOpts.body = JSON.stringify(opts.body);
    }

    let response: Response;
    try {
      response = await fetch(url, fetchOpts);
    } catch (err) {
      throw connectionError(err);
    }

    const data = await handleResponse(response);
    return { data, response };
  }

  private buildQuery(params: Record<string, string | number | undefined>): Record<string, string> {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query[key] = String(value);
    }
    return query;
  }
}

// -- Module-level helpers --

async function handleResponse(response: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!response.ok) {
    const errorCode = (body["error_code"] as string | undefined) ?? null;
    const rawErrors = body["errors"];
    const errors: Record<string, string[]> = {};
    if (typeof rawErrors === "object" && rawErrors !== null && !Array.isArray(rawErrors)) {
      for (const [key, value] of Object.entries(rawErrors as Record<string, unknown>)) {
        if (Array.isArray(value) && value.every((v): v is string => typeof v === "string")) {
          errors[key] = value;
        }
      }
    }

    const errorValues = Object.values(errors).flat();
    const message =
      (body["error"] as string | undefined) ??
      (errorValues.length > 0 ? errorValues.join(", ") : null) ??
      `HTTP ${String(response.status)}`;

    throw new AltTextApiError({ status: response.status, errorCode, errors, message });
  }

  return body;
}

function safeParseInt(value: string | null, fallback: number): number {
  const parsed = parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parsePagination(response: Response): Pagination {
  return {
    currentPage: safeParseInt(response.headers.get("current-page"), 1),
    pageItems: safeParseInt(response.headers.get("page-items"), 20),
    totalPages: safeParseInt(response.headers.get("total-pages"), 1),
    totalCount: safeParseInt(response.headers.get("total-count"), 0),
  };
}

function connectionError(err: unknown): AltTextApiError {
  const message = err instanceof Error ? err.message : String(err);
  return new AltTextApiError({
    status: 0,
    errorCode: "connection_error",
    errors: {},
    message: `Could not connect to AltText.ai API: ${message}`,
  });
}
