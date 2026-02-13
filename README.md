# AltText.ai MCP Server

An [MCP](https://modelcontextprotocol.io/) server that lets AI assistants generate alt text, manage image libraries, and audit web pages for accessibility using the [AltText.ai](https://alttext.ai) API.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible client.

## Setup

**Requirements:** Node.js 18+ and an [AltText.ai API key](https://alttext.ai/account/api)

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "alttext-ai": {
      "command": "npx",
      "args": ["-y", "@alttextai/alttext-mcp"],
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

### Account Management
| Tool | Description |
|------|-------------|
| `get_account` | Check your credit balance, usage, and account settings. |
| `update_account` | Update account name, webhook URL, or notification email. |

### Generate Alt Text
| Tool | Description |
|------|-------------|
| `generate_alt_text` | Generate alt text for an image URL. Supports multilingual output, custom prompts, keywords, and character limits. Costs 1 credit. |
| `generate_alt_text_from_file` | Generate alt text from a local image file. Automatically base64-encodes and uploads. Costs 1 credit. |
| `translate_image` | Add alt text in a new language for an existing image (by asset_id). Costs 1 credit. |

### Manage Image Library
| Tool | Description |
|------|-------------|
| `list_images` | List images in your library with pagination. |
| `search_images` | Search your image library by alt text content. |
| `get_image` | Get details for a specific image by asset ID. |
| `update_image` | Update alt text, tags, or metadata for an image. |
| `delete_image` | Delete an image from your library. |

### Bulk Operations
| Tool | Description |
|------|-------------|
| `bulk_create` | Bulk generate alt text from a CSV file with image URLs and optional metadata. |
| `scrape_page` | Scan a web page, find images missing alt text, and queue generation. Results are async -- use `list_images` to check progress. |

## Example Prompts

Once configured, just ask your AI assistant:

### Account & Credits
- "How many credits do I have left?"
- "Update my webhook URL to https://example.com/webhook"

### Generate Alt Text
- "Generate alt text for https://example.com/photo.jpg"
- "Generate alt text for this image" (with local file)
- "Generate alt text in French and Spanish for this image"
- "Translate image abc123 to German"

### Manage Library
- "Search my images for 'product photo'"
- "List my images"
- "Get details for image abc123"
- "Update the alt text for asset abc123"
- "Delete image xyz789"

### Bulk Operations
- "Scan https://example.com for images missing alt text"
- "Process this CSV file of image URLs" (bulk_create)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ALTTEXT_API_KEY` | Yes | Your [AltText.ai API key](https://alttext.ai/account/api) |
| `ALTTEXT_API_BASE_URL` | No | Override the API base URL (default: `https://alttext.ai/api/v1`) |

## Development

```sh
npm install
npm run build
npm test
npm run lint
```

Tests use mocked `fetch` calls -- no API key or network access needed.

## License

MIT
