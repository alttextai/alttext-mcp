import type { Command as CommanderCommand } from "commander";
import { AltTextApiError, type AccountRecord } from "@alttext_ai/core";
import {
  credentialsPath,
  removeCredentials,
  storeCredential,
  type CredentialSource,
} from "../credentials.js";
import { CliError, EXIT } from "../exit-codes.js";
import { writeJson, writeLine } from "../output.js";
import { apiFor, connectWith, type Context } from "./context.js";

const SOURCES: Readonly<Record<CredentialSource, string>> = {
  env: "ALTTEXT_API_KEY environment variable (overrides any stored key)",
  keychain: "OS keychain",
  file: "credentials file",
};

async function readKey(context: Context): Promise<string> {
  const { io } = context;
  if (!io.stdinIsTTY) return (await io.readStdin()).trim();
  if (context.noInput) {
    throw new CliError(
      "No API key given. Pipe it on stdin, e.g. `alttext login < key.txt`.",
      EXIT.usage,
    );
  }
  return (await io.prompt("AltText.ai API key: ", { hidden: true })).trim();
}

async function verify(context: Context, apiKey: string): Promise<AccountRecord> {
  try {
    return await apiFor(context.io, apiKey).getAccount();
  } catch (error) {
    if (error instanceof AltTextApiError && error.errorCode === "api_key_revoked") {
      throw new CliError(
        "This key was revoked. Log in with an active key; nothing was stored.",
        EXIT.auth,
      );
    }
    if (error instanceof AltTextApiError && error.errorCode === "invalid_api_key") {
      throw new CliError("This key isn't valid; nothing was stored.", EXIT.auth);
    }
    throw error;
  }
}

export async function login(context: Context): Promise<void> {
  const { io } = context;
  const apiKey = await readKey(context);
  if (apiKey === "") throw new CliError("No API key given; nothing was stored.", EXIT.usage);

  const account = await verify(context, apiKey);
  const storedIn = await storeCredential(io, apiKey);
  const location =
    storedIn === "keychain" ? "the OS keychain" : credentialsPath(io.env, io.homedir);

  if (context.json) {
    writeJson(io, {
      account: account.name,
      key_kind: account.api_key?.kind ?? null,
      can_manage_keys: account.api_key?.can_manage_keys === true,
      stored_in: storedIn,
    });
  } else {
    const kind = account.api_key ? ` with a ${account.api_key.kind} key` : "";
    writeLine(io.stdout, `Logged in to ${account.name}${kind}. Stored in ${location}.`);
  }
  if (io.env["ALTTEXT_API_KEY"]) {
    writeLine(io.stderr, "Note: ALTTEXT_API_KEY is set and takes precedence over the stored key.");
  }
}

export async function logout(context: Context): Promise<void> {
  const { io } = context;
  const removed = await removeCredentials(io);
  if (context.json) {
    writeJson(io, { removed });
  } else {
    writeLine(
      io.stdout,
      removed.length > 0
        ? `Logged out. Removed the key from the ${removed.map((place) => (place === "file" ? "credentials file" : "OS keychain")).join(" and ")}.`
        : "No stored key to remove.",
    );
  }
  if (io.env["ALTTEXT_API_KEY"]) {
    writeLine(io.stderr, "Note: ALTTEXT_API_KEY is still set in this environment.");
  }
}

export async function whoami(context: Context): Promise<void> {
  const { io } = context;
  const { api, credential } = await connectWith(io);
  const account = await api.getAccount();
  const result = {
    account: account.name,
    key_name: account.api_key?.name ?? null,
    key_kind: account.api_key?.kind ?? null,
    can_manage_keys: account.api_key?.can_manage_keys === true,
    credential_source: credential.source,
  };
  if (context.json) {
    writeJson(io, result);
    return;
  }
  const lines = [`Account: ${result.account}`];
  if (result.key_name) lines.push(`Key: ${result.key_name}`);
  lines.push(`Key kind: ${result.key_kind ?? "unknown"}`);
  lines.push(`Can manage keys: ${result.can_manage_keys ? "yes" : "no"}`);
  lines.push(`Credential source: ${SOURCES[credential.source]}`);
  writeLine(io.stdout, lines.join("\n"));
}

export function addAuthCommands(
  program: CommanderCommand,
  contextOf: (invoked: CommanderCommand) => Context,
): void {
  const actions: [string, string, (context: Context) => Promise<void>][] = [
    [
      "login",
      "Store an API key after checking it works. Reads the key from a hidden prompt, or from stdin when piped",
      login,
    ],
    ["logout", "Remove the stored API key from the OS keychain and the credentials file", logout],
    ["whoami", "Show the account, the key's kind, what it can do and where it came from", whoami],
  ];
  for (const [name, description, action] of actions) {
    program
      .command(name)
      .description(description)
      .action(async (...args: unknown[]) => {
        await action(contextOf(args[args.length - 1] as CommanderCommand));
      });
  }
}
