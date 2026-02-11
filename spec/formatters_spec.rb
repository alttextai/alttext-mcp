# frozen_string_literal: true

require "spec_helper"
require "mcp"
require_relative "../lib/formatters"

RSpec.describe Formatters do
  describe ".format_image" do
    subject { described_class.format_image(image) }

    context "with a complete image" do
      let(:image) do
        {
          "asset_id" => "abc123",
          "alt_text" => "A red bicycle",
          "url" => "https://example.com/bike.jpg",
          "alt_texts" => { "en" => "A red bicycle", "fr" => "Un velo rouge" },
          "tags" => ["product", "bicycle"],
          "metadata" => { "source" => "upload" },
          "created_at" => 1700000000,
        }
      end

      it "includes the asset ID" do
        expect(subject).to include("Asset ID: abc123")
      end

      it "includes the alt text" do
        expect(subject).to include("Alt text: A red bicycle")
      end

      it "includes the URL" do
        expect(subject).to include("URL: https://example.com/bike.jpg")
      end

      it "includes language translations" do
        expect(subject).to include("Languages:")
        expect(subject).to include("en: A red bicycle")
        expect(subject).to include("fr: Un velo rouge")
      end

      it "includes tags" do
        expect(subject).to include("Tags: product, bicycle")
      end

      it "includes metadata as JSON" do
        expect(subject).to include('Metadata: {"source":"upload"}')
      end

      it "formats the created_at timestamp" do
        expect(subject).to include("Created: 2023-11-14T22:13:20Z")
      end
    end

    context "with minimal image data" do
      let(:image) { { "asset_id" => "xyz", "alt_text" => nil } }

      it "shows (none) for missing alt text" do
        expect(subject).to include("Alt text: (none)")
      end

      it "omits URL when not present" do
        expect(subject).not_to include("URL:")
      end

      it "omits languages when empty" do
        expect(subject).not_to include("Languages:")
      end
    end

    context "with errors" do
      let(:image) do
        {
          "asset_id" => "err1",
          "alt_text" => nil,
          "errors" => { "url" => ["is unreachable"] },
        }
      end

      it "includes error messages" do
        expect(subject).to include("Errors: is unreachable")
      end
    end
  end

  describe ".format_image_list" do
    subject { described_class.format_image_list(result) }

    context "with images" do
      let(:result) do
        {
          images: [
            { "asset_id" => "img1", "alt_text" => "First image" },
            { "asset_id" => "img2", "alt_text" => nil },
          ],
          pagination: { current_page: 1, total_pages: 3, total_count: 25 },
        }
      end

      it "shows pagination summary" do
        expect(subject).to include("Found 25 images (page 1 of 3)")
      end

      it "lists images with alt text" do
        expect(subject).to include("- img1: First image")
      end

      it "shows placeholder for missing alt text" do
        expect(subject).to include("- img2: (no alt text)")
      end
    end

    context "with no images" do
      let(:result) do
        { images: [], pagination: { current_page: 1, total_pages: 1, total_count: 0 } }
      end

      it "shows no images message" do
        expect(subject).to include("No images found.")
      end
    end
  end

  describe ".format_account" do
    subject { described_class.format_account(account) }

    context "with a complete account" do
      let(:account) do
        {
          "name" => "Test Account",
          "usage" => 42,
          "usage_limit" => 1000,
          "default_lang" => "en",
          "gpt_prompt" => "Describe this image",
          "max_chars" => 125,
          "webhook_url" => "https://example.com/hook",
          "notification_email" => "test@example.com",
          "whitelabel" => false,
          "no_quotes" => true,
          "ending_period" => true,
        }
      end

      it "shows credits remaining" do
        expect(subject).to include("Credits: 958 remaining (42 used of 1000)")
      end

      it "includes account name" do
        expect(subject).to include("Account: Test Account")
      end

      it "includes default language" do
        expect(subject).to include("Default language: en")
      end

      it "includes optional fields when present" do
        expect(subject).to include("Custom prompt: Describe this image")
        expect(subject).to include("Max chars: 125")
        expect(subject).to include("Webhook: https://example.com/hook")
        expect(subject).to include("Notification email: test@example.com")
        expect(subject).to include("Ending period: true")
      end
    end

    context "with minimal account" do
      let(:account) do
        {
          "name" => "Basic",
          "usage" => 0,
          "usage_limit" => 100,
          "default_lang" => "en",
          "whitelabel" => false,
          "no_quotes" => false,
        }
      end

      it "omits optional fields when absent" do
        expect(subject).not_to include("Custom prompt:")
        expect(subject).not_to include("Max chars:")
        expect(subject).not_to include("Webhook:")
        expect(subject).not_to include("Notification email:")
        expect(subject).not_to include("Ending period:")
      end
    end
  end

  describe ".format_scrape_result" do
    subject { described_class.format_scrape_result(result, "https://example.com/page") }

    context "with queued images" do
      let(:result) do
        {
          "scraped_images" => [
            { "src" => "img1.jpg" },
            { "src" => "img2.jpg", "skip_reason" => "already processed" },
          ],
          "total_processed" => 1,
        }
      end

      it "shows URL and counts" do
        expect(subject).to include("Scraped https://example.com/page")
        expect(subject).to include("Images found: 2")
        expect(subject).to include("Images queued for processing: 1")
      end

      it "lists queued images" do
        expect(subject).to include("- img1.jpg [queued]")
      end

      it "lists skipped images with reason" do
        expect(subject).to include("- img2.jpg [skipped: already processed]")
      end

      it "includes async processing note" do
        expect(subject).to include("Images are being processed asynchronously")
      end
    end

    context "with no images" do
      let(:result) do
        {
          "scraped_images" => [],
          "total_processed" => 0,
        }
      end

      it "shows zero counts" do
        expect(subject).to include("Images found: 0")
        expect(subject).to include("Images queued for processing: 0")
      end

      it "omits async note when nothing was processed" do
        expect(subject).not_to include("asynchronously")
      end
    end

    context "with errors" do
      let(:result) do
        {
          "scraped_images" => [],
          "total_processed" => 0,
          "errors" => { "url" => ["is unreachable"] },
        }
      end

      it "includes error messages" do
        expect(subject).to include("Errors: is unreachable")
      end
    end
  end

  describe ".error_response" do
    context "with AltTextApiError" do
      let(:error) do
        AltTextApiError.new(
          status: 422,
          error_code: "validation_error",
          errors: { "url" => ["is invalid"] },
  
          message: "Validation failed",
        )
      end

      subject { described_class.error_response(error) }

      it "returns an MCP error response" do
        expect(subject).to be_a(MCP::Tool::Response)
        expect(subject.error?).to be true
      end

      it "includes status and message" do
        text = subject.content.first[:text]
        expect(text).to include("Error (422): Validation failed")
      end

      it "includes error code" do
        text = subject.content.first[:text]
        expect(text).to include("Code: validation_error")
      end
    end

    context "with AltTextApiError without error_code" do
      let(:error) do
        AltTextApiError.new(
          status: 500,
          error_code: nil,
          errors: {},
  
          message: "Internal server error",
        )
      end

      subject { described_class.error_response(error) }

      it "omits the code line" do
        text = subject.content.first[:text]
        expect(text).not_to include("Code:")
      end
    end

    context "with a generic error" do
      let(:error) { StandardError.new("something broke") }
      subject { described_class.error_response(error) }

      it "returns an MCP error response" do
        expect(subject.error?).to be true
      end

      it "includes the error message" do
        text = subject.content.first[:text]
        expect(text).to eq("Error: something broke")
      end
    end
  end
end
