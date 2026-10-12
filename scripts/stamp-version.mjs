#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const workspaces = ["packages/core", "packages/mcp", "packages/cli"];

const read = (path) => JSON.parse(readFileSync(root + path, "utf8"));
const { version } = read("package.json");

const targets = [
  ...workspaces.map((dir) => ({
    path: `${dir}/package.json`,
    fields: (json) => [[json, "version"]],
  })),
  {
    path: "server.json",
    fields: (json) => [[json, "version"], ...json.packages.map((entry) => [entry, "version"])],
  },
  {
    path: "package-lock.json",
    fields: (json) =>
      ["", ...workspaces].map((dir) => [json.packages[dir], "version"]).concat([[json, "version"]]),
  },
];

const drift = [];
for (const target of targets) {
  const json = read(target.path);
  let changed = false;
  for (const [object, key] of target.fields(json)) {
    if (object[key] === version) continue;
    drift.push(`${target.path}: ${object[key]} (expected ${version})`);
    object[key] = version;
    changed = true;
  }
  if (changed && !check) writeFileSync(root + target.path, `${JSON.stringify(json, null, 2)}\n`);
}

if (check && drift.length > 0) {
  console.error(`Version drift from root package.json ${version}:\n  ${drift.join("\n  ")}`);
  console.error("Run `npm run version:stamp` and commit the result.");
  process.exit(1);
}
console.log(
  check ? `All packages at ${version}` : `Stamped ${version} (${drift.length} field(s) updated)`,
);
