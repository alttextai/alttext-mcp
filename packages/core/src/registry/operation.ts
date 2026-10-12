import { z } from "zod";
import type { AltTextApi } from "../api.js";

export type Permission = "read" | "write" | "keys_read" | "keys_write";

export interface OperationAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/** no side effects, but open-world since it reads the image library */
export const READ: OperationAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function change(hints: {
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
}): OperationAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: hints.destructive,
    idempotentHint: hints.idempotent,
    openWorldHint: hints.openWorld,
  };
}

export interface OperationResult<O extends z.ZodObject> {
  readonly text: string;
  readonly structured: z.infer<O>;
}

interface HandlerResult {
  readonly text: string;
  readonly structured: unknown;
}

/** shared by the MCP server and the CLI */
export interface Operation<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodObject = z.ZodObject,
> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly annotations: OperationAnnotations;
  readonly permission: Permission;
  readonly localFilesOnly: boolean;
  readonly command: { readonly noun: string; readonly verb: string };
  handler(api: AltTextApi, input: z.infer<I>): Promise<HandlerResult>;
}

export function defineOperation<I extends z.ZodObject, O extends z.ZodObject>(
  operation: Operation<I, O>,
): Operation<I, O> {
  return operation;
}

/** checks the structured output against the declared schema */
export async function runOperation<I extends z.ZodObject, O extends z.ZodObject>(
  operation: Operation<I, O>,
  api: AltTextApi,
  input: z.infer<I>,
): Promise<OperationResult<O>> {
  const { text, structured } = await operation.handler(api, input);
  return { text, structured: operation.output.parse(structured) };
}

/** the JSON Schemas MCP clients see in tools/list */
export function operationJsonSchemas(operation: Operation): {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
} {
  return {
    input: z.toJSONSchema(operation.input, { target: "draft-7", io: "input" }),
    output: z.toJSONSchema(operation.output, { target: "draft-7", io: "output" }),
  };
}
