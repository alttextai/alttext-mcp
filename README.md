# AltText.ai MCP Server

An [MCP](https://modelcontextprotocol.io/) server that lets AI assistants generate alt text, manage image libraries, and audit web pages for accessibility using the [AltText.ai](https://alttext.ai) API.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible client.

## Setup

**Requirements:** Ruby 3.2+ and an [AltText.ai API key](https://alttext.ai/account/api)

```sh
git clone https://github.com/alttextai/alttext-mcp.git
cd alttext-mcp
bundle install
```

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "alttext-ai": {
      "command": "ruby",
      "args": ["/absolute/path/to/alttext-mcp/bin/alttext-mcp"],
      "env": {
        "ALTTEXT_API_KEY": "your-api-key"
      }
    }
  }
}
```

**Where to add this:**

| Client | Config file |
|--------|-------------|
| Claude Desktop | `claude_desktop_config.json` |
| Claude Code | `.mcp.json` in your project root |
| Cursor | MCP settings in the Cursor preferences |
| Windsurf | MCP settings in the Windsurf preferences |

## Tools

| Tool | Description |
|------|-------------|
| `generate_alt_text` | Generate alt text for an image URL. Supports multilingual output, custom prompts, keywords, and character limits. Costs 1 credit. |
| `scrape_page` | Scan a web page, find images missing alt text, and queue generation. Results are async -- use `list_images` to check progress. |
| `list_images` | List images in your library with pagination. |
| `search_images` | Search your image library by alt text content. |
| `get_image` | Get details for a specific image by asset ID. |
| `update_image` | Update alt text, tags, or metadata for an image. |
| `delete_image` | Delete an image from your library. |
| `get_account` | Check your credit balance, usage, and account settings. |

## Example Prompts

Once configured, just ask your AI assistant:

- "Generate alt text for https://example.com/photo.jpg"
- "Generate alt text in French and Spanish for this image"
- "Scan https://example.com for images missing alt text"
- "How many credits do I have left?"
- "Search my images for 'product photo'"
- "Update the alt text for asset abc123"

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ALTTEXT_API_KEY` | Yes | Your [AltText.ai API key](https://alttext.ai/account/api) |
| `ALTTEXT_API_BASE_URL` | No | Override the API base URL (default: `https://alttext.ai/api/v1`) |

## Development

```sh
bundle install
bundle exec rspec
```

Tests use [WebMock](https://github.com/bblimke/webmock) to stub HTTP requests -- no API key or network access needed.

## License

MIT
