import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Io, Keychain } from "./io.js";

export type CredentialSource = "env" | "keychain" | "file";

export interface Credential {
  readonly apiKey: string;
  readonly source: CredentialSource;
}

export function credentialsPath(env: Io["env"], home: string): string {
  const configHome = env["XDG_CONFIG_HOME"] || join(home, ".config");
  return join(configHome, "alttext", "credentials");
}

async function keychainOf(io: Io): Promise<Keychain | null> {
  try {
    return await io.loadKeychain();
  } catch {
    return null;
  }
}

async function readFileKey(path: string): Promise<string | null> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    // an interrupted login can leave the file empty or truncated
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("api_key" in parsed)) return null;
  return typeof parsed.api_key === "string" && parsed.api_key !== "" ? parsed.api_key : null;
}

/** precedence: ALTTEXT_API_KEY, then the OS keychain, then the credentials file */
export async function resolveCredential(io: Io): Promise<Credential | null> {
  const fromEnv = io.env["ALTTEXT_API_KEY"];
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  const keychain = await keychainOf(io);
  if (keychain) {
    try {
      const stored = keychain.get();
      if (stored) return { apiKey: stored, source: "keychain" };
    } catch {
      // a locked or missing keychain service falls through to the file
    }
  }

  const fromFile = await readFileKey(credentialsPath(io.env, io.homedir));
  return fromFile === null ? null : { apiKey: fromFile, source: "file" };
}

async function writeCredentialsFile(path: string, apiKey: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ api_key: apiKey })}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

/** falls back to the 0600 file when no keychain works */
export async function storeCredential(io: Io, apiKey: string): Promise<"keychain" | "file"> {
  const path = credentialsPath(io.env, io.homedir);
  const keychain = await keychainOf(io);
  if (keychain) {
    try {
      keychain.set(apiKey);
      await rm(path, { force: true });
      return "keychain";
    } catch {
      // no usable keychain service; use the file
    }
  }
  await writeCredentialsFile(path, apiKey);
  return "file";
}

export async function removeCredentials(io: Io): Promise<("keychain" | "file")[]> {
  const removed: ("keychain" | "file")[] = [];
  const keychain = await keychainOf(io);
  if (keychain) {
    try {
      if (keychain.remove()) removed.push("keychain");
    } catch {
      // nothing stored there, or no keychain service
    }
  }
  const path = credentialsPath(io.env, io.homedir);
  if ((await readFileKey(path).catch(() => null)) !== null) removed.push("file");
  await rm(path, { force: true });
  return removed;
}
