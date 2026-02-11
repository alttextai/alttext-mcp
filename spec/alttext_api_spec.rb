# frozen_string_literal: true

require 'spec_helper'

RSpec.describe AltTextApi do
  let(:api_key) { 'test-api-key-123' }
  let(:api) { described_class.new(api_key: api_key) }
  let(:base_url) { 'https://alttext.ai/api/v1' }

  describe '#get_account' do
    subject { api.get_account }

    before do
      stub_request(:get, "#{base_url}/account")
        .with(headers: { 'X-API-Key' => api_key })
        .to_return(
          status: 200,
          body: { 'name' => 'Test Account', 'usage' => 42, 'usage_limit' => 1000 }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns parsed account data' do
      expect(subject).to eq('name' => 'Test Account', 'usage' => 42, 'usage_limit' => 1000)
    end

    it 'sends the API key header' do
      subject
      expect(WebMock).to have_requested(:get, "#{base_url}/account")
        .with(headers: { 'X-API-Key' => api_key })
    end
  end

  describe '#create_image' do
    let(:image_url) { 'https://example.com/photo.jpg' }
    subject { api.create_image(url: image_url) }

    before do
      stub_request(:post, "#{base_url}/images")
        .to_return(
          status: 200,
          body: { 'asset_id' => 'abc123', 'alt_text' => 'A photo', 'url' => image_url }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns image data with alt text' do
      expect(subject).to include('asset_id' => 'abc123', 'alt_text' => 'A photo')
    end

    it 'sends async: false in the request body' do
      subject
      expect(WebMock).to have_requested(:post, "#{base_url}/images")
        .with(body: hash_including('image' => { 'url' => image_url }, 'async' => false))
    end

    context 'with optional parameters' do
      subject do
        api.create_image(
          url: image_url,
          lang: 'en,fr',
          keywords: ['product'],
          overwrite: false,
          tags: ['hero'],
          metadata: { 'source' => 'test' }
        )
      end

      it 'includes all parameters in the request body' do
        subject
        expect(WebMock).to(have_requested(:post, "#{base_url}/images")
          .with do |req|
            body = JSON.parse(req.body)
            body['lang'] == 'en,fr' &&
              body['keywords'] == ['product'] &&
              body['overwrite'] == false &&
              body['image']['tags'] == ['hero'] &&
              body['image']['metadata'] == { 'source' => 'test' }
          end)
      end
    end

    context 'with overwrite: false' do
      subject { api.create_image(url: image_url, overwrite: false) }

      it 'sends overwrite as false (not omitted)' do
        subject
        expect(WebMock).to(have_requested(:post, "#{base_url}/images")
          .with { |req| JSON.parse(req.body)['overwrite'] == false })
      end
    end
  end

  describe '#create_image_from_raw' do
    let(:raw_data) { Base64.strict_encode64('fake-image-bytes') }
    subject { api.create_image_from_raw(raw: raw_data) }

    before do
      stub_request(:post, "#{base_url}/images")
        .to_return(
          status: 200,
          body: { 'asset_id' => 'raw123', 'alt_text' => 'A raw image' }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns image data with alt text' do
      expect(subject).to include('asset_id' => 'raw123', 'alt_text' => 'A raw image')
    end

    it 'sends raw in the image envelope' do
      subject
      expect(WebMock).to have_requested(:post, "#{base_url}/images")
        .with(body: hash_including('image' => { 'raw' => raw_data }, 'async' => false))
    end

    context 'with optional parameters' do
      subject do
        api.create_image_from_raw(
          raw: raw_data,
          lang: 'en',
          keywords: ['photo'],
          tags: ['uploaded']
        )
      end

      it 'includes all parameters in the request body' do
        subject
        expect(WebMock).to(have_requested(:post, "#{base_url}/images")
          .with do |req|
            body = JSON.parse(req.body)
            body['lang'] == 'en' &&
              body['keywords'] == ['photo'] &&
              body['image']['tags'] == ['uploaded'] &&
              body['image']['raw'] == raw_data
          end)
      end
    end
  end

  describe '#list_images' do
    subject { api.list_images(page: 2, limit: 10) }

    before do
      stub_request(:get, "#{base_url}/images")
        .with(query: { 'page' => '2', 'limit' => '10' })
        .to_return(
          status: 200,
          body: { 'images' => [{ 'asset_id' => 'img1' }] }.to_json,
          headers: {
            'Content-Type' => 'application/json',
            'current-page' => '2',
            'page-items' => '10',
            'total-pages' => '5',
            'total-count' => '47'
          }
        )
    end

    it 'returns images with pagination metadata' do
      result = subject
      expect(result[:images]).to eq([{ 'asset_id' => 'img1' }])
      expect(result[:pagination]).to eq(
        current_page: 2,
        page_items: 10,
        total_pages: 5,
        total_count: 47
      )
    end
  end

  describe '#search_images' do
    subject { api.search_images(query: 'sunset') }

    before do
      stub_request(:get, "#{base_url}/images/search")
        .with(query: { 'q' => 'sunset' })
        .to_return(
          status: 200,
          body: { 'images' => [{ 'asset_id' => 'sun1', 'alt_text' => 'A sunset' }] }.to_json,
          headers: {
            'Content-Type' => 'application/json',
            'current-page' => '1',
            'total-pages' => '1',
            'total-count' => '1'
          }
        )
    end

    it 'sends query as q parameter' do
      subject
      expect(WebMock).to have_requested(:get, "#{base_url}/images/search")
        .with(query: { 'q' => 'sunset' })
    end

    it 'returns matching images' do
      expect(subject[:images].first['alt_text']).to eq('A sunset')
    end
  end

  describe '#get_image' do
    subject { api.get_image(asset_id: 'abc123') }

    before do
      stub_request(:get, "#{base_url}/images/abc123")
        .to_return(
          status: 200,
          body: { 'asset_id' => 'abc123', 'alt_text' => 'Test image' }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns image details' do
      expect(subject).to include('asset_id' => 'abc123', 'alt_text' => 'Test image')
    end

    context 'with special characters in asset_id' do
      subject { api.get_image(asset_id: 'shp-123/456') }

      before do
        stub_request(:get, "#{base_url}/images/shp-123%2F456")
          .to_return(
            status: 200,
            body: { 'asset_id' => 'shp-123/456' }.to_json,
            headers: { 'Content-Type' => 'application/json' }
          )
      end

      it 'URL-encodes the asset_id in the path' do
        expect(subject['asset_id']).to eq('shp-123/456')
      end
    end
  end

  describe '#update_account' do
    subject { api.update_account(name: 'New Name', webhook_url: 'https://example.com/webhook') }

    before do
      stub_request(:patch, "#{base_url}/account")
        .to_return(
          status: 200,
          body: { 'name' => 'New Name', 'webhook_url' => 'https://example.com/webhook' }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns updated account data' do
      expect(subject).to include('name' => 'New Name', 'webhook_url' => 'https://example.com/webhook')
    end

    it 'sends PATCH with account envelope' do
      subject
      expect(WebMock).to have_requested(:patch, "#{base_url}/account")
        .with(body: hash_including('account' => include('name' => 'New Name')))
    end

    context 'with partial updates' do
      subject { api.update_account(notification_email: 'test@example.com') }

      it 'only sends provided fields' do
        subject
        expect(WebMock).to(have_requested(:patch, "#{base_url}/account")
          .with do |req|
            body = JSON.parse(req.body)
            body['account'].key?('notification_email') && !body['account'].key?('name')
          end)
      end
    end
  end

  describe '#translate_image' do
    subject { api.translate_image(asset_id: 'abc123', lang: 'de') }

    before do
      stub_request(:post, "#{base_url}/images")
        .to_return(
          status: 200,
          body: {
            'asset_id' => 'abc123',
            'alt_texts' => [
              { 'lang' => 'en', 'alt_text' => 'A photo' },
              { 'lang' => 'de', 'alt_text' => 'Ein Foto' }
            ]
          }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns image data with translations' do
      expect(subject['alt_texts'].length).to eq(2)
    end

    it 'sends asset_id and lang without a URL' do
      subject
      expect(WebMock).to have_requested(:post, "#{base_url}/images")
        .with(body: { 'image' => { 'asset_id' => 'abc123' }, 'lang' => 'de', 'async' => false }.to_json)
    end
  end

  describe '#update_image' do
    subject { api.update_image(asset_id: 'abc123', alt_text: 'Updated text') }

    before do
      stub_request(:patch, "#{base_url}/images/abc123")
        .to_return(
          status: 200,
          body: { 'asset_id' => 'abc123', 'alt_text' => 'Updated text' }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'sends PATCH with alt_text in image envelope' do
      subject
      expect(WebMock).to have_requested(:patch, "#{base_url}/images/abc123")
        .with(body: hash_including('image' => { 'alt_text' => 'Updated text' }))
    end
  end

  describe '#delete_image' do
    subject { api.delete_image(asset_id: 'abc123') }

    before do
      stub_request(:delete, "#{base_url}/images/abc123")
        .to_return(
          status: 200,
          body: {}.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'sends DELETE request' do
      subject
      expect(WebMock).to have_requested(:delete, "#{base_url}/images/abc123")
    end
  end

  describe '#bulk_create' do
    let(:csv_file) { StringIO.new("url\nhttps://example.com/img1.jpg\nhttps://example.com/img2.jpg") }
    subject { api.bulk_create(csv_file: csv_file, email: 'test@example.com') }

    before do
      stub_request(:post, "#{base_url}/images/bulk_create")
        .to_return(
          status: 200,
          body: {
            'success' => true,
            'rows' => 2,
            'row_errors' => [],
            'error' => nil
          }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns bulk import results' do
      expect(subject['success']).to eq(true)
      expect(subject['rows']).to eq(2)
    end

    it 'sends multipart form data' do
      subject
      expect(WebMock).to have_requested(:post, "#{base_url}/images/bulk_create")
    end
  end

  describe '#scrape_page' do
    let(:page_url) { 'https://example.com/page' }
    subject { api.scrape_page(url: page_url) }

    before do
      stub_request(:post, "#{base_url}/images/page_scrape")
        .to_return(
          status: 200,
          body: {
            'scraped_images' => [{ 'src' => 'img1.jpg' }],
            'total_processed' => 1
          }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns scrape results' do
      expect(subject['total_processed']).to eq(1)
      expect(subject['scraped_images'].length).to eq(1)
    end

    it 'sends URL in page_scrape envelope' do
      subject
      expect(WebMock).to have_requested(:post, "#{base_url}/images/page_scrape")
        .with(body: hash_including('page_scrape' => { 'url' => page_url }))
    end

    context 'with optional parameters' do
      subject do
        api.scrape_page(
          url: page_url,
          lang: 'en,fr',
          keywords: ['product'],
          negative_keywords: ['logo'],
          gpt_prompt: 'Custom prompt',
          max_chars: 120,
          overwrite: true
        )
      end

      it 'includes all parameters in the request body' do
        subject
        expect(WebMock).to(have_requested(:post, "#{base_url}/images/page_scrape")
          .with do |req|
            body = JSON.parse(req.body)
            body['lang'] == 'en,fr' &&
              body['keywords'] == ['product'] &&
              body['negative_keywords'] == ['logo'] &&
              body['gpt_prompt'] == 'Custom prompt' &&
              body['max_chars'] == 120 &&
              body['overwrite'] == true
          end)
      end
    end
  end

  describe 'error handling' do
    context 'API returns 401' do
      before do
        stub_request(:get, "#{base_url}/account")
          .to_return(
            status: 401,
            body: { 'error' => 'Invalid API key', 'error_code' => 'unauthorized' }.to_json,
            headers: { 'Content-Type' => 'application/json' }
          )
      end

      it 'raises AltTextApiError with status and error_code' do
        expect { api.get_account }.to raise_error(AltTextApiError) do |error|
          expect(error.status).to eq(401)
          expect(error.error_code).to eq('unauthorized')
          expect(error.message).to eq('Invalid API key')
        end
      end
    end

    context 'API returns 422 with validation errors' do
      before do
        stub_request(:post, "#{base_url}/images")
          .to_return(
            status: 422,
            body: { 'errors' => { 'url' => ['is invalid', 'must be public'] } }.to_json,
            headers: { 'Content-Type' => 'application/json' }
          )
      end

      it 'raises AltTextApiError with errors hash' do
        expect { api.create_image(url: 'bad') }.to raise_error(AltTextApiError) do |error|
          expect(error.status).to eq(422)
          expect(error.errors).to eq('url' => ['is invalid', 'must be public'])
          expect(error.message).to eq('is invalid, must be public')
        end
      end
    end

    context 'API returns 429 rate limit' do
      before do
        stub_request(:get, "#{base_url}/account")
          .to_return(
            status: 429,
            body: { 'error' => 'Rate limit exceeded' }.to_json,
            headers: { 'Content-Type' => 'application/json' }
          )
      end

      it 'raises AltTextApiError with 429 status' do
        expect { api.get_account }.to raise_error(AltTextApiError) do |error|
          expect(error.status).to eq(429)
        end
      end
    end

    context 'API returns non-JSON error body' do
      before do
        stub_request(:get, "#{base_url}/account")
          .to_return(status: 502, body: '<html>Bad Gateway</html>')
      end

      it 'raises AltTextApiError with HTTP status as message' do
        expect { api.get_account }.to raise_error(AltTextApiError) do |error|
          expect(error.status).to eq(502)
          expect(error.message).to eq('HTTP 502')
        end
      end
    end

    context 'connection refused' do
      before do
        stub_request(:get, "#{base_url}/account").to_raise(Errno::ECONNREFUSED)
      end

      it 'raises AltTextApiError with connection_error code' do
        expect { api.get_account }.to raise_error(AltTextApiError) do |error|
          expect(error.status).to eq(0)
          expect(error.error_code).to eq('connection_error')
        end
      end
    end

    context 'request timeout' do
      before do
        stub_request(:get, "#{base_url}/account").to_timeout
      end

      it 'raises AltTextApiError with connection_error code' do
        expect { api.get_account }.to raise_error(AltTextApiError) do |error|
          expect(error.error_code).to eq('connection_error')
        end
      end
    end

    context 'DNS resolution failure' do
      before do
        stub_request(:get, "#{base_url}/account").to_raise(SocketError.new('getaddrinfo: nodename nor servname provided'))
      end

      it 'raises AltTextApiError with connection_error code' do
        expect { api.get_account }.to raise_error(AltTextApiError) do |error|
          expect(error.error_code).to eq('connection_error')
        end
      end
    end

    context 'write timeout' do
      before do
        stub_request(:get, "#{base_url}/account").to_raise(Net::WriteTimeout)
      end

      it 'raises AltTextApiError with connection_error code' do
        expect { api.get_account }.to raise_error(AltTextApiError) do |error|
          expect(error.error_code).to eq('connection_error')
        end
      end
    end
  end

  describe 'connection retry' do
    it 'retries once on Errno::EPIPE' do
      stub_request(:get, "#{base_url}/account")
        .to_raise(Errno::EPIPE).then
        .to_return(
          status: 200,
          body: { 'name' => 'Test' }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )

      expect(api.get_account['name']).to eq('Test')
    end

    it 'raises AltTextApiError after repeated connection reset' do
      stub_request(:get, "#{base_url}/account").to_raise(Errno::ECONNRESET)

      expect { api.get_account }.to raise_error(AltTextApiError) do |error|
        expect(error.error_code).to eq('connection_error')
      end
    end
  end

  describe 'custom base URL' do
    let(:api) { described_class.new(api_key: api_key, base_url: 'https://staging.alttext.ai/api/v1') }

    before do
      stub_request(:get, 'https://staging.alttext.ai/api/v1/account')
        .to_return(
          status: 200,
          body: { 'name' => 'Staging' }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'uses the custom base URL' do
      expect(api.get_account['name']).to eq('Staging')
    end
  end

  describe '#build_request (via integration)' do
    it 'raises ArgumentError for unsupported HTTP method' do
      expect { api.send(:request, :put, '/test') }.to raise_error(ArgumentError, /unsupported HTTP method: put/)
    end
  end

  describe 'pagination defaults' do
    before do
      stub_request(:get, "#{base_url}/images")
        .to_return(
          status: 200,
          body: { 'images' => [] }.to_json,
          headers: { 'Content-Type' => 'application/json' }
        )
    end

    it 'returns sensible defaults when headers are missing' do
      result = api.list_images
      expect(result[:pagination]).to eq(
        current_page: 1,
        page_items: 20,
        total_pages: 1,
        total_count: 0
      )
    end
  end
end
