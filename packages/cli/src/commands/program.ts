import { Command as CommanderCommand, CommanderError } from "commander";
import { AltTextApiError, operations, VERSION } from "@alttext_ai/core";
import { EXIT, exitCodeFor } from "../exit-codes.js";
import type { Io } from "../io.js";
import { colorEnabled, writeLine } from "../output.js";
import { addAuthCommands } from "./auth.js";
import { contextFor } from "./context.js";
import { addOperationCommand } from "./operations.js";
import { buildCommandTable } from "./registry.js";

const NOUNS: Readonly<Record<string, string>> = {
  account: "View and update your account",
  images: "Generate, find and manage alt text for images",
  pages: "Find a web page's images and queue alt text for them",
  keys: "Create, rotate, revoke and inspect the account's site API keys",
};

export function buildProgram(io: Io): CommanderCommand {
  const program = new CommanderCommand("alttext")
    .description("Command-line tool for AltText.ai")
    .version(VERSION, "-v, --version", "Print the version")
    .option("--json", "Print the result as JSON on stdout")
    .option("--no-input", "Never prompt; fail instead when input is needed")
    .option("--yes", "Run destructive commands without asking for confirmation")
    .option("--dry-run", "Read the target and show what a change would do, without making it")
    .option("--show-tokens", "Show full tokens in keys list and keys get")
    .helpOption("-h, --help", "Show help")
    .helpCommand(false)
    .configureHelp({ showGlobalOptions: true, helpWidth: 100 })
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
      getOutHasColors: () => colorEnabled(io.stdout, io.env),
      getErrHasColors: () => colorEnabled(io.stderr, io.env),
      getOutHelpWidth: () => 100,
      getErrHelpWidth: () => 100,
    })
    .exitOverride();

  const contextOf = (invoked: CommanderCommand) => contextFor(io, invoked);
  addAuthCommands(program, contextOf);

  const nouns = new Map<string, CommanderCommand>();
  for (const command of buildCommandTable()) {
    const operation = operations.find((item) => item.name === command.operation);
    if (!operation) continue;
    let parent = nouns.get(command.noun);
    if (!parent) {
      parent = program
        .command(command.noun)
        .description(NOUNS[command.noun] ?? command.noun)
        .helpCommand(false);
      nouns.set(command.noun, parent);
    }
    addOperationCommand(parent, command, operation, contextOf);
  }
  return program;
}

function report(io: Io, error: unknown): number {
  if (error instanceof CommanderError) {
    const shownHelp = ["commander.helpDisplayed", "commander.version"].includes(error.code);
    return shownHelp ? EXIT.ok : EXIT.usage;
  }
  const code = exitCodeFor(error);
  let message = error instanceof Error ? error.message : String(error);
  if (error instanceof AltTextApiError) {
    if (code === EXIT.rateLimited) {
      message +=
        error.retryAfter === null
          ? ". Retry later."
          : `. Retry in ${String(error.retryAfter)} seconds.`;
    } else if (error.requiredScope !== null) {
      message += ` (needs the ${error.requiredScope} permission)`;
    }
  }
  writeLine(io.stderr, `Error: ${message}`);
  return code;
}

/** Runs the CLI against user arguments and returns the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    await buildProgram(io).parseAsync([...argv], { from: "user" });
    return EXIT.ok;
  } catch (error) {
    return report(io, error);
  }
}
