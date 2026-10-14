import { randomUUID } from "node:crypto";
import {
  Argument,
  InvalidArgumentError,
  Option,
  type Command as CommanderCommand,
} from "commander";
import {
  createApiKey,
  formatApiKey,
  getApiKey,
  listApiKeys,
  revealApiKeyToken,
  rotateApiKey,
  runOperation,
  type AltTextApi,
  type Operation,
} from "@alttext_ai/core";
import { CliError, EXIT } from "../exit-codes.js";
import { table, writeJson, writeLine } from "../output.js";
import { connect, type Context } from "./context.js";
import {
  CONFIRMED_OPERATIONS,
  describeEffect,
  readTarget,
  type Effect,
  type Target,
} from "./effects.js";
import type { Command, CommandFlag } from "./registry.js";

const POSITIONAL = new Set(["id", "asset_id"]);
const TOKEN_OPERATIONS = new Set([createApiKey.name, rotateApiKey.name, revealApiKeyToken.name]);
const NULL_WORDS = new Set(["none", "null", "unlimited"]);
// commander turns a parsed null into "", so null travels as this marker until the action
const NULL_VALUE = Symbol("null");

interface PropertySchema {
  type?: string;
  anyOf?: { type?: string }[];
}

function typesOf(command: Command, property: string): { type: string; nullable: boolean } {
  const properties = command.inputSchema["properties"] as Record<string, PropertySchema>;
  const schema = properties[property] ?? {};
  const types = schema.anyOf ? schema.anyOf.map((item) => item.type ?? "string") : [];
  const type = schema.type ?? types.find((item) => item !== "null") ?? "string";
  return { type, nullable: types.includes("null") };
}

function numberParser(integer: boolean, nullable: boolean) {
  return (value: string): number | typeof NULL_VALUE => {
    if (nullable && NULL_WORDS.has(value.toLowerCase())) return NULL_VALUE;
    const parsed = Number(value);
    if (value.trim() === "" || Number.isNaN(parsed) || (integer && !Number.isInteger(parsed))) {
      throw new InvalidArgumentError(integer ? "Expected a whole number." : "Expected a number.");
    }
    return parsed;
  };
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function collectPairs(
  value: string,
  previous: Record<string, string> | undefined,
): Record<string, string> {
  const split = value.indexOf("=");
  if (split < 1) throw new InvalidArgumentError("Expected key=value.");
  return { ...previous, [value.slice(0, split)]: value.slice(split + 1) };
}

function optionFor(command: Command, flag: CommandFlag): Option[] {
  const { type, nullable } = typesOf(command, flag.property);
  const description = flag.description ?? "";
  switch (type) {
    case "boolean":
      return [
        new Option(flag.flag, description),
        new Option(`--no-${flag.flag.slice(2)}`, `Set ${flag.property} to false`),
      ];
    case "array":
      return [new Option(`${flag.flag} <value>`, `${description} (repeatable)`).argParser(collect)];
    case "object":
      return [
        new Option(`${flag.flag} <key=value>`, `${description} (repeatable)`).argParser(
          collectPairs,
        ),
      ];
    case "integer":
    case "number": {
      const option = new Option(
        `${flag.flag} <${nullable ? "n-or-none" : "n"}>`,
        nullable ? `${description} (pass "none" for null)` : description,
      ).argParser(numberParser(type === "integer", nullable));
      return [flag.required ? option.makeOptionMandatory() : option];
    }
    default: {
      const option = new Option(`${flag.flag} <value>`, description);
      if (flag.choices) option.choices(flag.choices);
      return [flag.required ? option.makeOptionMandatory() : option];
    }
  }
}

function isPositional(flag: CommandFlag): boolean {
  return flag.required && POSITIONAL.has(flag.property);
}

function flagName(command: Command, property: PropertyKey | undefined): string {
  const flag = command.flags.find((item) => item.property === property);
  if (!flag) return "input";
  return isPositional(flag) ? `<${flag.property.replaceAll("_", "-")}>` : flag.flag;
}

function validate(
  command: Command,
  operation: Operation,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result = operation.input.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${flagName(command, issue.path[0])}: ${issue.message}`,
  );
  throw new CliError(problems.join("\n"), EXIT.usage);
}

function printEffect(context: Context, effect: Effect, stream: "stdout" | "stderr"): void {
  const lines = [`${effect.summary}.`, ...effect.consequences];
  writeLine(context.io[stream], lines.join("\n"));
}

async function confirm(context: Context, effect: Effect): Promise<void> {
  printEffect(context, effect, "stderr");
  const answer = await context.io.prompt("Continue? [y/N] ", { hidden: false });
  if (!/^y(es)?$/i.test(answer.trim())) throw new CliError("Cancelled; nothing was changed.");
}

function requireConfirmable(context: Context, operation: Operation): void {
  if (!CONFIRMED_OPERATIONS.has(operation.name) || context.yes || context.dryRun) return;
  if (context.noInput || !context.io.stdinIsTTY) {
    throw new CliError(
      `${operation.command.noun} ${operation.command.verb} needs confirmation; pass --yes to run it without a prompt.`,
      EXIT.usage,
    );
  }
}

async function dryRun(
  context: Context,
  api: AltTextApi,
  operation: Operation,
  input: Record<string, unknown>,
): Promise<void> {
  const target = await readTarget(api, operation, input);
  const effect = describeEffect(operation, input, target);
  if (context.json) {
    writeJson(context.io, {
      dry_run: true,
      operation: operation.name,
      input,
      target,
      effect: [effect.summary, ...effect.consequences],
    });
    return;
  }
  writeLine(context.io.stdout, "Dry run; nothing was changed. This would:");
  writeLine(
    context.io.stdout,
    [`${effect.summary}.`, ...effect.consequences].map((line) => `  ${line}`).join("\n"),
  );
}

interface KeyPage {
  api_keys: Target[];
  next_cursor: string | null;
  has_more: boolean;
}

async function keyPage(
  context: Context,
  api: AltTextApi,
  operation: Operation,
  input: Record<string, unknown>,
): Promise<KeyPage> {
  if (!context.showTokens) {
    return (await runOperation(operation, api, input)).structured as unknown as KeyPage;
  }
  const raw = await api.listApiKeys(input);
  const page = operation.output.parse(raw) as unknown as KeyPage;
  return {
    ...page,
    api_keys: page.api_keys.map((key, index) => ({
      ...key,
      token: raw.api_keys[index]?.token ?? null,
    })),
  };
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value as string | number);
}

function tokenCell(context: Context, key: Target): string {
  if (context.showTokens) return cell(key["token"]);
  return key["token_hint"] ? `…${cell(key["token_hint"])}` : "";
}

async function listKeys(
  context: Context,
  api: AltTextApi,
  operation: Operation,
  input: Record<string, unknown>,
): Promise<void> {
  let page = await keyPage(context, api, operation, input);
  const keys = [...page.api_keys];
  while (context.all && page.has_more && page.next_cursor !== null) {
    page = await keyPage(context, api, operation, { ...input, after: page.next_cursor });
    keys.push(...page.api_keys);
  }
  const result = context.all ? { api_keys: keys, next_cursor: null, has_more: false } : page;

  if (context.json) {
    writeJson(context.io, result);
  } else if (keys.length === 0) {
    writeLine(context.io.stdout, "No keys found.");
  } else {
    const rows = keys.map((key) => [
      cell(key["id"]),
      cell(key["name"]),
      cell(key["status"]),
      tokenCell(context, key),
      cell(key["billable_credits"]),
      typeof key["usage_limit"] === "number" ? String(key["usage_limit"]) : "unlimited",
      cell(key["resets_at"]).slice(0, 10),
    ]);
    context.io.stdout.write(
      table(
        ["ID", "NAME", "STATUS", "TOKEN", "BILLABLE", "LIMIT", "RESETS"],
        rows,
        context.paint,
        (row, column, padded) =>
          column === 2 && keys[row]?.["status"] === "revoked" ? context.paint.red(padded) : padded,
      ),
    );
  }
  if (result.has_more && result.next_cursor !== null) {
    writeLine(
      context.io.stderr,
      `More keys exist. Pass --all to list them all, or --after ${result.next_cursor} for the next page.`,
    );
  }
}

async function getKeyWithToken(
  context: Context,
  api: AltTextApi,
  operation: Operation,
  input: Record<string, unknown>,
): Promise<void> {
  const raw = await api.getApiKey({
    id: input["id"] as number,
    detail: input["detail"] === "full" ? "full" : undefined,
  });
  const key = operation.output.parse(raw) as Target;
  const token = raw.token ?? null;
  if (context.json) {
    writeJson(context.io, { ...key, token });
    return;
  }
  writeLine(context.io.stdout, formatApiKey(raw, { token }));
}

function printIssued(context: Context, operation: Operation, key: Target): void {
  const token = key["token"];
  if (context.json) {
    writeJson(context.io, key);
  } else if (typeof token === "string" && token !== "") {
    context.io.stdout.write(`${token}\n`);
  }
  const label = `key ${cell(key["id"])} "${cell(key["name"])}"`;
  const notes: Record<string, string> = {
    [createApiKey.name]: `Created ${label}.`,
    [rotateApiKey.name]: `Rotated ${label}. The old token no longer works.`,
    [revealApiKeyToken.name]: `Revealed the token of ${label}; the reveal is recorded in its history.`,
  };
  if (!context.json) writeLine(context.io.stderr, notes[operation.name] ?? "");
  if (typeof key["integration_warning"] === "string") {
    writeLine(context.io.stderr, `Warning: ${key["integration_warning"]}`);
  }
  if (typeof token !== "string" || token === "") {
    throw new CliError(`Key ${cell(key["id"])} is ${cell(key["status"])} and has no token.`);
  }
}

async function execute(
  context: Context,
  command: Command,
  operation: Operation,
  raw: Record<string, unknown>,
): Promise<void> {
  const input = validate(command, operation, raw);
  requireConfirmable(context, operation);
  const api = await connect(context.io);
  const mutates = !operation.annotations.readOnlyHint;

  if (context.dryRun && mutates) return dryRun(context, api, operation, input);

  if (CONFIRMED_OPERATIONS.has(operation.name) && !context.yes) {
    await confirm(
      context,
      describeEffect(operation, input, await readTarget(api, operation, input)),
    );
  }

  const flags = new Set(command.flags.map((flag) => flag.property));
  if (flags.has("idempotency_key") && input["idempotency_key"] === undefined) {
    input["idempotency_key"] = randomUUID();
    writeLine(context.io.stderr, `Idempotency key: ${String(input["idempotency_key"])}`);
  }

  if (operation.name === listApiKeys.name) return listKeys(context, api, operation, input);
  if (operation.name === getApiKey.name && context.showTokens) {
    return getKeyWithToken(context, api, operation, input);
  }

  const result = await runOperation(operation, api, input);
  if (TOKEN_OPERATIONS.has(operation.name)) {
    printIssued(context, operation, result.structured as Target);
  } else if (context.json) {
    writeJson(context.io, result.structured);
  } else {
    writeLine(context.io.stdout, result.text);
  }
}

export function addOperationCommand(
  parent: CommanderCommand,
  command: Command,
  operation: Operation,
  contextOf: (invoked: CommanderCommand) => Context,
): void {
  const sub = parent.command(command.verb).description(command.description);
  const positional = command.flags.filter(isPositional);
  for (const flag of positional) {
    const argument = new Argument(`<${flag.property.replaceAll("_", "-")}>`, flag.description);
    const { type } = typesOf(command, flag.property);
    sub.addArgument(type === "integer" ? argument.argParser(numberParser(true, false)) : argument);
  }
  const attributes = new Map<string, string>();
  for (const flag of command.flags) {
    if (isPositional(flag)) continue;
    for (const option of optionFor(command, flag)) {
      sub.addOption(option);
      attributes.set(option.attributeName(), flag.property);
    }
  }
  if (operation.name === listApiKeys.name) {
    sub.option("--all", "Follow cursors and list every matching key");
  }

  sub.action(async (...args: unknown[]) => {
    const invoked = args[args.length - 1] as CommanderCommand;
    const input: Record<string, unknown> = {};
    positional.forEach((flag, index) => {
      input[flag.property] = invoked.processedArgs[index] as unknown;
    });
    for (const [attribute, value] of Object.entries(invoked.opts())) {
      const property = attributes.get(attribute);
      if (property !== undefined && value !== undefined) {
        input[property] = value === NULL_VALUE ? null : value;
      }
    }
    await execute(contextOf(invoked), command, operation, input);
  });
}
