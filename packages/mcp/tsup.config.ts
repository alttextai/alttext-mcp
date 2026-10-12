import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts", "remote/server": "src/remote/server.ts" },
  format: "esm",
  target: "node22",
  platform: "node",
  clean: true,
  removeNodeProtocol: false,
  noExternal: ["@alttext_ai/core"],
  define: { __VERSION__: JSON.stringify(version) },
});
