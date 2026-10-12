/** Pagination metadata from AltText.ai list/search API responses. */
export interface Pagination {
  readonly currentPage: number;
  readonly pageItems: number;
  readonly totalPages: number;
  readonly totalCount: number;
}

/** Result from list_images or search_images endpoints. */
export interface ImageListResult {
  readonly images: readonly ImageRecord[];
  readonly pagination: Pagination;
}

/** A single image record from the AltText.ai API. */
export interface ImageRecord {
  readonly asset_id: string;
  readonly alt_text?: string | null;
  readonly url?: string | null;
  readonly alt_texts?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly created_at?: number;
  readonly error_code?: string | null;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

/** Account information from the AltText.ai API. */
export interface AccountRecord {
  readonly name: string;
  readonly usage: number;
  readonly usage_limit: number;
  readonly default_lang: string;
  readonly gpt_prompt?: string;
  readonly max_chars?: number;
  readonly webhook_url?: string;
  readonly notification_email?: string;
  readonly whitelabel: boolean;
  readonly no_quotes: boolean;
  readonly ending_period?: boolean;
  readonly remove_symbols?: boolean;
  readonly subscription?: unknown;
  readonly api_key?: CallingKey;
}

/** The key that made the request, as GET /account describes it. */
export interface CallingKey {
  readonly kind: string;
  readonly can_manage_keys: boolean;
  readonly name?: string | null;
  readonly origin?: string | null;
}

/** An API key as /api/v1/api_keys returns it; token is absent once revoked. */
export interface ApiKeyRecord {
  readonly id: number;
  readonly name: string | null;
  readonly kind: string;
  readonly status: string;
  readonly token?: string | null;
  readonly token_hint?: string | null;
  readonly usage_limit?: number | null;
  readonly integration_warning?: string;
  readonly [field: string]: unknown;
}

/** One cursor page of API keys. */
export interface ApiKeyList {
  readonly api_keys: readonly ApiKeyRecord[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
}

/** One recorded change to an API key. */
export interface ApiKeyEvent {
  readonly id: number;
  readonly action: string;
  readonly actor?: { readonly type?: string | null; readonly name?: string | null } | null;
  readonly before?: Readonly<Record<string, unknown>> | null;
  readonly after?: Readonly<Record<string, unknown>> | null;
  readonly created_at: string;
}

/** One cursor page of a key's history. */
export interface ApiKeyHistory {
  readonly events: readonly ApiKeyEvent[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
}

/** Fields a key create or update sends; a null usage limit means unlimited. */
export interface ApiKeyChanges {
  readonly name?: string;
  readonly usageLimit?: number | null;
}

/** Result from the scrape_page endpoint. */
export interface ScrapeResult {
  readonly url?: string;
  readonly scraped_images: readonly ScrapedImage[];
  readonly total_processed: number;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

/** A single image discovered during page scraping. */
export interface ScrapedImage {
  readonly src?: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly skip_reason?: string;
}

/** Result from the bulk_create endpoint. */
export interface BulkCreateResult {
  readonly rows?: number;
  readonly row_errors?: readonly string[];
  readonly error?: string;
}

/** Options for generating alt text (shared by URL and file upload). */
export interface GenerateOptions {
  readonly assetId?: string;
  readonly lang?: string;
  readonly keywords?: readonly string[];
  readonly negativeKeywords?: readonly string[];
  readonly gptPrompt?: string;
  readonly maxChars?: number;
  readonly overwrite?: boolean;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Options for scraping a page. */
export interface ScrapePageOptions {
  readonly url: string;
  readonly html?: string;
  readonly includeExisting?: boolean;
  readonly lang?: string;
  readonly keywords?: readonly string[];
  readonly negativeKeywords?: readonly string[];
  readonly gptPrompt?: string;
  readonly maxChars?: number;
  readonly overwrite?: boolean;
}

/** Options for updating an existing image. */
export interface UpdateImageOptions {
  readonly assetId: string;
  readonly altText?: string;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly lang?: string;
  readonly overwrite?: boolean;
}

/** Options for updating account settings. */
export interface UpdateAccountOptions {
  readonly name?: string;
  readonly webhookUrl?: string;
  readonly notificationEmail?: string;
}
