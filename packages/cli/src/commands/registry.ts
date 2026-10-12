import {
  availableOperations,
  operationJsonSchemas,
  type Operation,
  type OperationAnnotations,
  type SurfaceOptions,
} from "@alttext_ai/core";

export const CLI_ONLY_COMMANDS: readonly string[] = ["login", "logout", "whoami"];

export interface CommandFlag {
  readonly flag: string;
  readonly property: string;
  readonly required: boolean;
  readonly description: string | undefined;
  readonly choices: readonly string[] | undefined;
}

export interface Command {
  readonly name: string;
  readonly noun: string;
  readonly verb: string;
  readonly operation: string;
  readonly description: string;
  readonly annotations: OperationAnnotations;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly flags: readonly CommandFlag[];
}

interface PropertySchema {
  description?: string;
  enum?: string[];
}

function toFlags(inputSchema: Record<string, unknown>): CommandFlag[] {
  const properties = (inputSchema["properties"] ?? {}) as Record<string, PropertySchema>;
  const required = new Set((inputSchema["required"] ?? []) as string[]);
  return Object.entries(properties).map(([property, schema]) => ({
    flag: `--${property.replaceAll("_", "-")}`,
    property,
    required: required.has(property),
    description: schema.description,
    choices: schema.enum,
  }));
}

function toCommand(operation: Operation): Command {
  const { input, output } = operationJsonSchemas(operation);
  const { noun, verb } = operation.command;
  return {
    name: `${noun} ${verb}`,
    noun,
    verb,
    operation: operation.name,
    description: operation.description,
    annotations: operation.annotations,
    inputSchema: input,
    outputSchema: output,
    flags: toFlags(input),
  };
}

/** key commands are always listed; the API refuses them to a site key */
export function buildCommandTable(options: SurfaceOptions = {}): Command[] {
  return availableOperations({ keys: true, ...options }).map(toCommand);
}
