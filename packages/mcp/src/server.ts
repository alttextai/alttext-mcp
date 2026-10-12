import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AltTextApi,
  AltTextApiError,
  availableOperations,
  keyAccess,
  runOperation,
  VERSION,
  type Operation,
  type SurfaceOptions,
} from "@alttext_ai/core";

export interface ServerOptions extends SurfaceOptions {
  readonly toolMeta?: (operation: Operation) => Record<string, unknown> | undefined;
}

const PROBE_TIMEOUT_MS = 10_000;

function errorContent(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof AltTextApiError) {
    const parts = [`Error (${String(err.status)}): ${err.message}`];
    if (err.errorCode) parts.push(`Code: ${err.errorCode}`);
    if (err.requiredScope) parts.push(`Required scope: ${err.requiredScope}`);
    if (err.retryAfter) parts.push(`Retry after: ${String(err.retryAfter)} seconds`);
    return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function createServer(api: AltTextApi, options: ServerOptions = {}): McpServer {
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
        _meta: options.toolMeta?.(operation),
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

/** any probe failure counts as no */
export async function canManageKeys(api: AltTextApi): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Account probe timed out"));
    }, PROBE_TIMEOUT_MS);
  });
  try {
    const account = await Promise.race([api.getAccount(), timeout]);
    return keyAccess(account).can_manage_keys;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** key tools appear only when the credential can use them */
export async function createLocalServer(api: AltTextApi): Promise<McpServer> {
  return createServer(api, { keys: await canManageKeys(api) });
}
