require "net/http"
require "uri"
require "json"

class AltTextApiError < StandardError
  attr_reader :status, :error_code, :errors, :raw_body

  def initialize(status:, error_code:, errors:, raw_body:, message:)
    @status = status
    @error_code = error_code
    @errors = errors
    @raw_body = raw_body
    super(message)
  end
end

class AltTextApi
  def initialize(api_key:, base_url: nil)
    @api_key = api_key
    @base_url = (base_url || "https://alttext.ai/api/v1").chomp("/")
  end

  def get_account
    data, = request(:get, "/account")
    data
  end

  def list_images(page: nil, limit: nil, lang: nil)
    query = {}
    query[:page] = page if page
    query[:limit] = limit if limit
    query[:lang] = lang if lang

    data, headers = request(:get, "/images", query: query)
    {
      images: data["images"],
      pagination: parse_pagination(headers),
    }
  end

  def search_images(query:, limit: nil, lang: nil)
    params = { q: query }
    params[:limit] = limit if limit
    params[:lang] = lang if lang

    data, headers = request(:get, "/images/search", query: params)
    {
      images: data["images"],
      pagination: parse_pagination(headers),
    }
  end

  def get_image(asset_id:, lang: nil)
    query = {}
    query[:lang] = lang if lang

    data, = request(:get, "/images/#{URI.encode_uri_component(asset_id)}", query: query)
    data
  end

  def create_image(url:, asset_id: nil, lang: nil, keywords: nil, negative_keywords: nil,
                   gpt_prompt: nil, max_chars: nil, overwrite: nil, tags: nil, metadata: nil)
    image_envelope = { url: url }
    image_envelope[:asset_id] = asset_id if asset_id
    image_envelope[:tags] = tags if tags
    image_envelope[:metadata] = metadata if metadata

    body = { image: image_envelope, async: false }
    body[:lang] = lang if lang
    body[:keywords] = keywords if keywords
    body[:negative_keywords] = negative_keywords if negative_keywords
    body[:gpt_prompt] = gpt_prompt if gpt_prompt
    body[:max_chars] = max_chars if max_chars
    body[:overwrite] = overwrite unless overwrite.nil?

    data, = request(:post, "/images", body: body)
    data
  end

  def update_image(asset_id:, alt_text: nil, tags: nil, metadata: nil, lang: nil, overwrite: nil)
    image_envelope = {}
    image_envelope[:alt_text] = alt_text unless alt_text.nil?
    image_envelope[:tags] = tags if tags
    image_envelope[:metadata] = metadata if metadata

    body = { image: image_envelope }
    body[:lang] = lang if lang
    body[:overwrite] = overwrite unless overwrite.nil?

    data, = request(:patch, "/images/#{URI.encode_uri_component(asset_id)}", body: body)
    data
  end

  def delete_image(asset_id:)
    data, = request(:delete, "/images/#{URI.encode_uri_component(asset_id)}")
    data
  end

  def scrape_page(url:, html: nil, include_existing: nil, lang: nil, keywords: nil,
                  negative_keywords: nil, gpt_prompt: nil, max_chars: nil, overwrite: nil)
    page_scrape_envelope = { url: url }
    page_scrape_envelope[:html] = html if html

    body = { page_scrape: page_scrape_envelope }
    body[:include_existing] = include_existing unless include_existing.nil?
    body[:lang] = lang if lang
    body[:keywords] = keywords if keywords
    body[:negative_keywords] = negative_keywords if negative_keywords
    body[:gpt_prompt] = gpt_prompt if gpt_prompt
    body[:max_chars] = max_chars if max_chars
    body[:overwrite] = overwrite unless overwrite.nil?

    data, = request(:post, "/images/page_scrape", body: body)
    data
  end

  private

  def request(method, path, body: nil, query: nil)
    uri = URI("#{@base_url}#{path}")
    if query&.any?
      uri.query = URI.encode_www_form(query.compact)
    end

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.open_timeout = 10
    http.read_timeout = 120

    req = build_request(method, uri, body)
    response = http.request(req)

    handle_response(response)
  rescue Errno::ECONNREFUSED, Net::OpenTimeout, Net::ReadTimeout, SocketError => e
    raise AltTextApiError.new(
      status: 0,
      error_code: "connection_error",
      errors: {},
      raw_body: {},
      message: "Could not connect to AltText.ai API: #{e.message}",
    )
  end

  def build_request(method, uri, body)
    klass = case method
            when :get    then Net::HTTP::Get
            when :post   then Net::HTTP::Post
            when :patch  then Net::HTTP::Patch
            when :delete then Net::HTTP::Delete
            end

    req = klass.new(uri)
    req["X-API-Key"] = @api_key
    req["Accept"] = "application/json"

    if body
      req["Content-Type"] = "application/json"
      req.body = JSON.generate(body)
    end

    req
  end

  def handle_response(response)
    body = begin
      JSON.parse(response.body || "{}")
    rescue JSON::ParserError
      {}
    end

    unless response.is_a?(Net::HTTPSuccess)
      error_code = body["error_code"]
      errors = body["errors"] || {}
      message = body["error"] ||
                errors.values.flatten.join(", ").then { |s| s.empty? ? nil : s } ||
                "HTTP #{response.code}"

      raise AltTextApiError.new(
        status: response.code.to_i,
        error_code: error_code,
        errors: errors,
        raw_body: body,
        message: message,
      )
    end

    [body, response]
  end

  def parse_pagination(response)
    {
      current_page: response["current-page"]&.to_i || 1,
      page_items: response["page-items"]&.to_i || 20,
      total_pages: response["total-pages"]&.to_i || 1,
      total_count: response["total-count"]&.to_i || 0,
    }
  end
end
