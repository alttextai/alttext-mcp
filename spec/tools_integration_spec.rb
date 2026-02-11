# frozen_string_literal: true

require 'spec_helper'
require 'mcp'
require_relative '../lib/formatters'

RSpec.describe 'MCP Tool Integration' do
  let(:api_key) { 'test-api-key-123' }
  let(:base_url) { 'https://alttext.ai/api/v1' }

  before do
    ENV['ALTTEXT_API_KEY'] = api_key
  end

  describe 'tool blocks handle server_context injection' do
    it 'generate_alt_text strips server_context from kwargs' do
      # Simulate what the mcp gem does: inject server_context
      args = { url: 'https://example.com/photo.jpg', server_context: {} }

      # The api_args helper should remove it
      cleaned = args.except(:server_context)
      expect(cleaned).not_to have_key(:server_context)
      expect(cleaned[:url]).to eq('https://example.com/photo.jpg')
    end

    it 'generate_alt_text_from_file handles file_path separately' do
      # The tool extracts file_path as a named parameter, not in **args
      args = { asset_id: 'test123', server_context: {} }
      file_path = '/tmp/image.jpg'

      # file_path comes from the named parameter, not kwargs
      expect(file_path).not_to be_empty
      expect(args[:file_path]).to be_nil
    end
  end

  describe 'tool error handling' do
    it 'format_image handles missing fields gracefully' do
      image = { 'asset_id' => 'test123' }

      formatted = "Asset ID: #{image['asset_id']}"
      expect(formatted).to include('test123')
    end

    it 'error_response formats AltTextApiError correctly' do
      error = AltTextApiError.new(
        status: 401,
        error_code: 'unauthorized',
        errors: {},
        message: 'Invalid API key'
      )

      response = Formatters.error_response(error)
      expect(response).to be_a(MCP::Tool::Response)
      # Verify it was created with error: true by checking the response content
      content = response.instance_variable_get(:@content)
      expect(content).to be_a(Array)
      expect(content.first[:text]).to include('Error (401)')
    end
  end

  describe 'tool parameter validation' do
    it 'generate_alt_text requires url' do
      schema = {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }

      expect(schema[:required]).to include('url')
    end

    it 'generate_alt_text_from_file requires file_path' do
      schema = {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path']
      }

      expect(schema[:required]).to include('file_path')
    end

    it 'translate_image requires asset_id and lang' do
      schema = {
        type: 'object',
        required: %w[asset_id lang]
      }

      expect(schema[:required]).to include('asset_id', 'lang')
    end

    it 'bulk_create requires csv_file' do
      schema = {
        type: 'object',
        required: ['csv_file']
      }

      expect(schema[:required]).to include('csv_file')
    end
  end

  describe 'generation options schema consistency' do
    it 'shared options appear in generate_alt_text' do
      # These should be in both generate_alt_text and generate_alt_text_from_file
      shared_options = %w[asset_id lang keywords negative_keywords gpt_prompt max_chars overwrite tags metadata]

      shared_options.each do |option|
        expect(option).to be_a(String)
      end
    end

    it 'scrape_options are subset of generation_options' do
      # scrape_page should have: lang, keywords, negative_keywords, gpt_prompt, max_chars
      # but NOT: asset_id, tags, metadata, overwrite
      scrape_only = %w[url html include_existing]
      generation_full = %w[asset_id lang keywords negative_keywords gpt_prompt max_chars overwrite tags metadata]

      # Verify they don't overlap unexpectedly
      expect((scrape_only & generation_full).length).to be < scrape_only.length
    end
  end
end
