# frozen_string_literal: true

require "json"
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
