import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

async function readFileKey(path: string): Promise<{ apiKey: string; preferred: boolean } | null> {
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
  if (typeof parsed.api_key !== "string" || parsed.api_key === "") return null;
  return {
    apiKey: parsed.api_key,
    preferred: "source" in parsed && parsed.source === "file",
  };
}

/** the latest fallback login stays active even when an older keychain entry unlocks */
export async function resolveCredential(io: Io): Promise<Credential | null> {
  const fromEnv = io.env["ALTTEXT_API_KEY"];
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  const fromFile = await readFileKey(credentialsPath(io.env, io.homedir));
  if (fromFile?.preferred) return { apiKey: fromFile.apiKey, source: "file" };

  const keychain = await keychainOf(io);
  if (keychain) {
    try {
      const stored = keychain.get();
      if (stored) return { apiKey: stored, source: "keychain" };
    } catch {
      // a locked or missing keychain service falls through to the file
    }
  }

  return fromFile === null ? null : { apiKey: fromFile.apiKey, source: "file" };
}

async function writeCredentialsFile(path: string, apiKey: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ api_key: apiKey, source: "file" })}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
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
  let keychainFailed = false;
  try {
    const keychain = await io.loadKeychain();
    if (keychain?.remove()) removed.push("keychain");
  } catch {
    keychainFailed = true;
  }
  const path = credentialsPath(io.env, io.homedir);
  if ((await readFileKey(path).catch(() => null)) !== null) removed.push("file");
  await rm(path, { force: true });
  if (keychainFailed) {
    throw new Error(
      "Could not remove the OS keychain credential. Unlock the keychain and run logout again.",
    );
  }
  return removed;
}
