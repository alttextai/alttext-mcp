import type { Command as CommanderCommand } from "commander";
import { AltTextApi, VERSION } from "@alttext_ai/core";
import { resolveCredential, type Credential } from "../credentials.js";
import { CliError, EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";
import { colorEnabled, style, type Style } from "../output.js";

export interface Context {
  readonly io: Io;
  readonly paint: Style;
  readonly json: boolean;
  readonly noInput: boolean;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly showTokens: boolean;
  readonly all: boolean;
}

interface GlobalOptions {
  json?: boolean;
  input?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  showTokens?: boolean;
  all?: boolean;
}

export function contextFor(io: Io, invoked: CommanderCommand): Context {
  const options = invoked.optsWithGlobals<GlobalOptions>();
  return {
    io,
    paint: style(colorEnabled(io.stdout, io.env)),
    json: options.json === true,
    noInput: options.input === false,
    yes: options.yes === true,
    dryRun: options.dryRun === true,
    showTokens: options.showTokens === true,
    all: options.all === true,
  };
}

export function apiFor(io: Io, apiKey: string): AltTextApi {
  return new AltTextApi(
    apiKey,
    io.env["ALTTEXT_API_BASE_URL"] || undefined,
    VERSION,
    "alttext-cli",
  );
}

export async function connectWith(io: Io): Promise<{ api: AltTextApi; credential: Credential }> {
  const credential = await resolveCredential(io);
  if (credential === null) {
    throw new CliError(
      "Not logged in. Run `alttext login`, or set ALTTEXT_API_KEY for this command.",
      EXIT.auth,
    );
  }
  return { api: apiFor(io, credential.apiKey), credential };
}

export async function connect(io: Io): Promise<AltTextApi> {
  return (await connectWith(io)).api;
}
