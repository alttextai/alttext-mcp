# frozen_string_literal: true

require "time"
require_relative "alttext_api"

module Formatters
  module_function

  def format_image(image)
    lines = []
    lines << "Asset ID: #{image["asset_id"]}"
    lines << "Alt text: #{image["alt_text"] || "(none)"}"
    lines << "URL: #{image["url"]}" if image["url"]

    alt_texts = image["alt_texts"] || {}
    if alt_texts.any?
      lines << "Languages:"
      alt_texts.each { |lang, text| lines << "  #{lang}: #{text}" }
    end

    lines << "Tags: #{image["tags"].join(", ")}" if image["tags"]&.any?
    lines << "Metadata: #{JSON.generate(image["metadata"])}" if image["metadata"]&.any?

    if image["created_at"].is_a?(Numeric)
      lines << "Created: #{Time.at(image["created_at"]).utc.iso8601}"
    end

    errors = image["errors"] || {}
    if errors.any?
      lines << "Errors: #{errors.values.flatten.join(", ")}"
    end

    lines.join("\n")
  end

  def format_image_list(result)
    pagination = result[:pagination]
    images = result[:images]

    lines = ["Found #{pagination[:total_count]} images (page #{pagination[:current_page]} of #{pagination[:total_pages]})", ""]

    if images.empty?
      lines << "No images found."
    else
      images.each do |image|
        lines << "- #{image["asset_id"]}: #{image["alt_text"] || "(no alt text)"}"
      end
    end

    lines.join("\n")
  end

  def format_account(account)
    credits_remaining = (account["usage_limit"] || 0) - (account["usage"] || 0)

    lines = [
      "Account: #{account["name"]}",
      "Credits: #{credits_remaining} remaining (#{account["usage"]} used of #{account["usage_limit"]})",
      "Default language: #{account["default_lang"]}",
    ]
    lines << "Custom prompt: #{account["gpt_prompt"]}" if account["gpt_prompt"]
    lines << "Max chars: #{account["max_chars"]}" if account["max_chars"]
    lines << "Webhook: #{account["webhook_url"]}" if account["webhook_url"]
    lines << "Notification email: #{account["notification_email"]}" if account["notification_email"]
    lines << "Whitelabel: #{account["whitelabel"]}"
    lines << "No quotes: #{account["no_quotes"]}"
    lines << "Ending period: true" if account["ending_period"]

    lines.join("\n")
  end

  def format_scrape_result(result, url)
    scraped = result["scraped_images"] || []

    lines = [
      "Scraped #{url}",
      "Images found: #{scraped.length}",
      "Images queued for processing: #{result["total_processed"] || 0}",
      "",
    ]

    if scraped.any?
      lines << "Discovered images:"
      scraped.each do |img|
        status = img["skip_reason"] ? "skipped: #{img["skip_reason"]}" : "queued"
        lines << "  - #{img["src"] || "(no src)"} [#{status}]"
      end
    end

    errors = result["errors"] || {}
    if errors.any?
      lines << "\nErrors: #{errors.values.flatten.join(", ")}"
    end

    if (result["total_processed"] || 0).positive?
      lines << "\nNote: Images are being processed asynchronously. Use list_images or get_image to check results."
    end

    lines.join("\n")
  end

  def error_response(error)
    if error.is_a?(AltTextApiError)
      parts = ["Error (#{error.status}): #{error.message}"]
      parts << "Code: #{error.error_code}" if error.error_code
      MCP::Tool::Response.new([{ type: "text", text: parts.join("\n") }], error: true)
    else
      MCP::Tool::Response.new([{ type: "text", text: "Error: #{error.message}" }], error: true)
    end
  end
end
