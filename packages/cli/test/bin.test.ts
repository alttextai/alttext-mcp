import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT } from "./helpers.js";

const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const run = promisify(execFile);

let server: Server;
let baseUrl: string;
const seen: { path: string; headers: IncomingHttpHeaders }[] = [];

beforeAll(async () => {
  if (!existsSync(BIN)) throw new Error(`No built CLI at ${BIN}; run npm run build first`);
  server = createServer((request, response) => {
    seen.push({ path: request.url ?? "", headers: request.headers });
    const ok = request.url === "/api/v1/account" && request.headers["x-api-key"] === "atai_smoke";
    response.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    response.end(
      JSON.stringify(ok ? ACCOUNT : { error: "Invalid", error_code: "invalid_api_key" }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("built bin", () => {
  const env = (apiKey: string) => ({
    PATH: process.env["PATH"],
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "alttext-bin-")),
    ALTTEXT_API_KEY: apiKey,
    ALTTEXT_API_BASE_URL: baseUrl,
    NO_COLOR: "1",
  });

  it("prints help", async () => {
    const { stdout } = await run(process.execPath, [BIN, "--help"]);
    expect(stdout).toContain("Usage: alttext");
    for (const noun of ["keys", "images", "account", "pages", "login", "whoami"]) {
      expect(stdout).toContain(noun);
    }
  });

  it("runs whoami against a local server with the CLI's X-Client header", async () => {
    const { stdout } = await run(process.execPath, [BIN, "whoami", "--json"], {
      env: env("atai_smoke"),
    });
    expect(JSON.parse(stdout)).toEqual({
      account: "NextNet",
      key_name: "Ops",
      key_kind: "full_access",
      can_manage_keys: true,
      credential_source: "env",
    });
    expect(seen.at(-1)?.headers["x-client"]).toMatch(/^alttext-cli\/\d+\.\d+\.\d+/);
  });

  it("exits 3 for a bad key", async () => {
    const failure = await run(process.execPath, [BIN, "whoami"], { env: env("atai_bad") }).catch(
      (error: unknown) => error as { code: number; stderr: string },
    );
    expect(failure).toMatchObject({ code: 3 });
    expect((failure as { stderr: string }).stderr).toContain("Invalid");
  });
});
