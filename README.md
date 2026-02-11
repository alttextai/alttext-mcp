# AltText.ai MCP Server

An MCP (Model Context Protocol) server that connects AI tools to the [AltText.ai](https://alttext.ai) API for generating and managing image alt text.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible client.

## Prerequisites

- Ruby 3.2+
- An [AltText.ai](https://alttext.ai) account with an API key

## Installation

Clone the repository and install dependencies:

```sh
git clone https://github.com/alttextai/alttext-mcp.git
cd alttext-mcp
bundle install
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alttext-ai": {
      "command": "ruby",
      "args": ["/path/to/alttext-mcp/bin/alttext-mcp"],
      "env": {
        "ALTTEXT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "alttext-ai": {
      "command": "ruby",
      "args": ["/path/to/alttext-mcp/bin/alttext-mcp"],
      "env": {
        "ALTTEXT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor / Windsurf

Follow the same pattern as Claude Code, adding the server configuration to your MCP settings.

## Available Tools

| Tool | Description |
|------|-------------|
| `generate_alt_text` | Generate AI-powered alt text for an image URL (1 credit) |
| `list_images` | List images in your library with pagination |
| `search_images` | Search images by alt text content |
| `get_image` | Get details for a specific image by asset ID |
| `update_image` | Update alt text, tags, or metadata for an image |
| `delete_image` | Delete an image from your library |
| `get_account` | Check credit balance, usage, and account settings |
| `scrape_page` | Find images on a web page and queue alt-text generation |

## Usage Examples

Once configured, ask your AI assistant:

- "Check my AltText.ai credit balance"
- "Generate alt text for https://example.com/photo.jpg"
- "Generate alt text in French and Spanish for this image"
- "List my recent images"
- "Search my images for 'product photo'"
- "Update the alt text for asset abc123 to 'A red bicycle'"
- "Scan https://example.com for images needing alt text"

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ALTTEXT_API_KEY` | Yes | Your AltText.ai API key |
| `ALTTEXT_API_BASE_URL` | No | Override the API base URL (default: `https://alttext.ai/api/v1`) |

## How It Works

This server wraps the AltText.ai REST API using the MCP stdio transport. Each tool maps to one API endpoint:

- `generate_alt_text` runs synchronously and returns the generated text immediately
- `scrape_page` queues images for background processing -- use `list_images` or `get_image` afterward to check results

## Development

Install dependencies:

```sh
bundle install
```

Run the test suite:

```sh
bundle exec rspec
```

Tests use [WebMock](https://github.com/bblimke/webmock) to stub all HTTP requests -- no API key or network access needed.

## License

MIT
