import type {
  AccountRecord,
  ApiKeyHistory,
  ApiKeyList,
  ApiKeyRecord,
  ImageListResult,
  ImageRecord,
  ScrapeResult,
} from "./types.js";

/** Format a single image record for display. */
export function formatImage(image: ImageRecord): string {
  const lines: string[] = [];
  lines.push(`Asset ID: ${image.asset_id}`);
  lines.push(`Alt text: ${image.alt_text ?? "(none)"}`);

  if (image.url) {
    lines.push(`URL: ${image.url}`);
  }

  if (image.alt_texts && Object.keys(image.alt_texts).length > 0) {
    lines.push("Languages:");
    for (const [lang, text] of Object.entries(image.alt_texts)) {
      lines.push(`  ${lang}: ${text}`);
    }
  }

  if (image.tags && image.tags.length > 0) {
    lines.push(`Tags: ${image.tags.join(", ")}`);
  }

  if (image.metadata && Object.keys(image.metadata).length > 0) {
    lines.push(`Metadata: ${JSON.stringify(image.metadata)}`);
  }

  if (typeof image.created_at === "number") {
    lines.push(`Created: ${new Date(image.created_at * 1000).toISOString()}`);
  }

  if (image.error_code) {
    lines.push(`Error code: ${image.error_code}`);
  }

  if (image.errors && Object.keys(image.errors).length > 0) {
    lines.push(`Errors: ${Object.values(image.errors).flat().join(", ")}`);
  }

  return lines.join("\n");
}

/** Format a paginated image list for display. */
export function formatImageList(result: ImageListResult): string {
  const { pagination, images } = result;
  const lines: string[] = [
    `Found ${String(pagination.totalCount)} images (page ${String(pagination.currentPage)} of ${String(pagination.totalPages)})`,
    "",
  ];

  if (images.length === 0) {
    lines.push("No images found.");
  } else {
    for (const image of images) {
      lines.push(`- ${image.asset_id}: ${image.alt_text ?? "(no alt text)"}`);
    }
  }

  return lines.join("\n");
}

/** Format account information for display. */
export function formatAccount(account: AccountRecord): string {
  const creditsRemaining = account.usage_limit - account.usage;

  const lines: string[] = [
    `Account: ${account.name}`,
    `Credits: ${String(creditsRemaining)} remaining (${String(account.usage)} used of ${String(account.usage_limit)})`,
    `Default language: ${account.default_lang}`,
  ];

  if (account.gpt_prompt) lines.push(`Custom prompt: ${account.gpt_prompt}`);
  if (account.max_chars) lines.push(`Max chars: ${String(account.max_chars)}`);
  if (account.webhook_url) lines.push(`Webhook: ${account.webhook_url}`);
  if (account.notification_email) lines.push(`Notification email: ${account.notification_email}`);
  lines.push(`Whitelabel: ${String(account.whitelabel)}`);
  lines.push(`No quotes: ${String(account.no_quotes)}`);
  if (account.ending_period) lines.push("Ending period: true");
  if (account.remove_symbols) lines.push("Remove symbols: true");
  if (account.api_key) {
    lines.push(`Key kind: ${account.api_key.kind}`);
    lines.push(`Can manage keys: ${account.api_key.can_manage_keys ? "yes" : "no"}`);
  }

  return lines.join("\n");
}

/** Format page scrape results for display. */
export function formatScrapeResult(result: ScrapeResult, url: string): string {
  const scraped = result.scraped_images;

  const lines: string[] = [
    `Scraped ${url}`,
    `Images found: ${String(scraped.length)}`,
    `Images queued for processing: ${String(result.total_processed)}`,
    "",
  ];

  if (scraped.length > 0) {
    lines.push("Discovered images:");
    for (const img of scraped) {
      const status = img.skip_reason ? `skipped: ${img.skip_reason}` : "queued";
      const dims =
        img.width !== undefined && img.height !== undefined
          ? ` (${String(img.width)}x${String(img.height)})`
          : "";
      lines.push(`  - ${img.src ?? "(no src)"}${dims} [${status}]`);
    }
  }

  if (result.errors && Object.keys(result.errors).length > 0) {
    lines.push(`\nErrors: ${Object.values(result.errors).flat().join(", ")}`);
  }

  if (result.total_processed > 0) {
    lines.push(
      "\nNote: Images are being processed asynchronously. Use list_images or get_image to check results.",
    );
  }

  return lines.join("\n");
}

/** Format one API key for display; never prints a token, only its last four characters. */
export function formatApiKey(key: ApiKeyRecord): string {
  const lines: string[] = [
    `Key ${String(key.id)}: ${key.name ?? "(unnamed)"}`,
    `Kind: ${key.kind}`,
    `Status: ${key.status}`,
  ];
  if (key.token_hint) lines.push(`Token: …${key.token_hint}`);
  if (typeof key["integration"] === "string") lines.push(`Integration: ${key["integration"]}`);
  lines.push(
    `Usage limit: ${typeof key.usage_limit === "number" ? String(key.usage_limit) : "Unlimited"}`,
  );
  if (typeof key["credits_used"] === "number")
    lines.push(`Credits used: ${String(key["credits_used"])}`);
  if (typeof key["billable_credits"] === "number")
    lines.push(`Billable credits: ${String(key["billable_credits"])}`);
  if (typeof key["last_used_at"] === "string") lines.push(`Last used: ${key["last_used_at"]}`);
  if (typeof key["revoked_at"] === "string") lines.push(`Revoked: ${key["revoked_at"]}`);
  if (key.integration_warning) lines.push(`Warning: ${key.integration_warning}`);
  return lines.join("\n");
}

/** Format a page of API keys, masked. */
export function formatApiKeyList(list: ApiKeyList): string {
  const lines: string[] = [`${String(list.api_keys.length)} API keys`, ""];
  if (list.api_keys.length === 0) lines.push("No API keys found.");
  for (const key of list.api_keys) {
    const hint = key.token_hint ? ` …${key.token_hint}` : "";
    const limit = typeof key.usage_limit === "number" ? String(key.usage_limit) : "unlimited";
    lines.push(
      `- ${String(key.id)}: ${key.name ?? "(unnamed)"} [${key.kind}, ${key.status}]${hint} limit ${limit}`,
    );
  }
  if (list.has_more && list.next_cursor) lines.push("", `More keys: after=${list.next_cursor}`);
  return lines.join("\n");
}

/** Format a page of a key's history. */
export function formatApiKeyHistory(id: number, history: ApiKeyHistory): string {
  const lines: string[] = [`History for key ${String(id)}`, ""];
  if (history.events.length === 0) lines.push("No changes recorded.");
  for (const event of history.events) {
    const actor = event.actor?.name ?? event.actor?.type ?? "unknown";
    const change =
      event.before || event.after
        ? ` ${JSON.stringify(event.before ?? {})} -> ${JSON.stringify(event.after ?? {})}`
        : "";
    lines.push(`- ${event.created_at} ${event.action} by ${actor}${change}`);
  }
  if (history.has_more && history.next_cursor)
    lines.push("", `More events: after=${history.next_cursor}`);
  return lines.join("\n");
}
