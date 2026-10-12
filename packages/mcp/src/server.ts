import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AltTextApi,
  AltTextApiError,
  availableOperations,
  runOperation,
  VERSION,
} from "@alttext_ai/core";

function errorContent(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof AltTextApiError) {
    const parts = [`Error (${String(err.status)}): ${err.message}`];
    if (err.errorCode) parts.push(`Code: ${err.errorCode}`);
    return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function createServer(api: AltTextApi, options: { localFiles?: boolean } = {}): McpServer {
  const server = new McpServer({ name: "alttext-ai", version: VERSION });

  for (const operation of availableOperations(options)) {
    server.registerTool(
      operation.name,
      {
        title: operation.title,
        annotations: operation.annotations,
        description: operation.description,
        inputSchema: operation.input,
        outputSchema: operation.output,
      },
      async (input) => {
        try {
          const { text, structured } = await runOperation(operation, api, input);
          return { content: [{ type: "text", text }], structuredContent: structured };
        } catch (err) {
          return errorContent(err);
        }
      },
    );
  }

  return server;
}
