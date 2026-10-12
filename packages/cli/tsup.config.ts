import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  target: "node22",
  platform: "node",
  clean: true,
  removeNodeProtocol: false,
  noExternal: ["@alttext_ai/core"],
  external: ["@napi-rs/keyring"],
  define: { __VERSION__: JSON.stringify(version) },
});
