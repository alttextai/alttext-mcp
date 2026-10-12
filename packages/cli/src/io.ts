import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";

export interface OutputStream {
  readonly isTTY?: boolean;
  write(chunk: string): unknown;
}

/** any method may throw when no keychain service runs */
export interface Keychain {
  get(): string | null;
  set(token: string): void;
  remove(): boolean;
}

/** injected so tests can run the CLI without a terminal or keychain */
export interface Io {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homedir: string;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly stdinIsTTY: boolean;
  readStdin(): Promise<string>;
  prompt(question: string, options: { hidden: boolean }): Promise<string>;
  loadKeychain(): Promise<Keychain | null>;
}

const KEYCHAIN_SERVICE = "alttext";
const KEYCHAIN_ACCOUNT = "api_key";

interface KeyringModule {
  Entry: new (
    service: string,
    account: string,
  ) => {
    getPassword(): string | null | undefined;
    setPassword(password: string): void;
    deletePassword(): boolean;
  };
}

// optional dependency: a platform without a prebuilt binary falls back to the credentials file
async function loadKeychain(): Promise<Keychain | null> {
  let keyring: KeyringModule;
  try {
    keyring = (await import("@napi-rs/keyring")) as KeyringModule;
  } catch {
    return null;
  }
  const entry = new keyring.Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  return {
    get: () => entry.getPassword() ?? null,
    set: (token) => {
      entry.setPassword(token);
    },
    remove: () => entry.deletePassword(),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function readHidden(question: string): Promise<string> {
  const { stdin, stderr } = process;
  stderr.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u0003") {
          finish(new Error("Cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function prompt(question: string, { hidden }: { hidden: boolean }): Promise<string> {
  if (hidden) return readHidden(question);
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

export function processIo(): Io {
  return {
    env: process.env,
    homedir: homedir(),
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTTY: process.stdin.isTTY,
    readStdin,
    prompt,
    loadKeychain,
  };
}
