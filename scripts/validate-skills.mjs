#!/usr/bin/env node
// checks every skill's frontmatter, local links and `alttext` commands against the built CLI's help
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const cliBin = join(root, "packages/cli/dist/index.js");
const errors = [];

function fail(file, message) {
  errors.push(`${relative(root, file)}: ${message}`);
}

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return entry.endsWith(".md") ? [path] : [];
  });
}

function parseFrontmatter(file, text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    fail(file, "missing YAML frontmatter between --- lines at the top");
    return null;
  }
  const fields = {};
  for (const line of match[1].split("\n")) {
    if (line.trim() === "") continue;
    const pair = /^([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) {
      fail(file, `frontmatter line is not a single-line key: value pair: ${line}`);
      continue;
    }
    fields[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

function checkFrontmatter(file, skillName, fields) {
  const { name, description } = fields;
  if (!name) fail(file, "frontmatter needs a name");
  else {
    if (name.length > 64) fail(file, "name is longer than 64 characters");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      fail(file, "name may use only lowercase letters, numbers and single hyphens");
    }
    if (/anthropic|claude/i.test(name)) fail(file, 'name may not contain "anthropic" or "claude"');
    if (name !== skillName) fail(file, `name "${name}" must match its directory "${skillName}"`);
  }
  if (!description) fail(file, "frontmatter needs a non-empty description");
  else {
    if (description.length > 1024) fail(file, "description is longer than 1024 characters");
    if (!/\buse when\b/i.test(description))
      fail(file, 'description must say when to use it ("Use when ...")');
  }
  for (const [key, value] of Object.entries(fields)) {
    if (/<[a-z/][^>]*>/i.test(value)) fail(file, `${key} may not contain XML tags`);
  }
}

function checkLinks(file, text) {
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
    if (!existsSync(resolve(dirname(file), target.split("#")[0]))) {
      fail(file, `links to a missing file: ${target}`);
    }
  }
}

function help(args) {
  return execFileSync(process.execPath, [cliBin, ...args, "--help"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function section(text, heading) {
  const start = text.indexOf(`\n${heading}:\n`);
  if (start === -1) return [];
  const lines = text.slice(start + heading.length + 3).split("\n");
  const end = lines.findIndex((line) => !line.startsWith(" ") && line.trim() !== "");
  return end === -1 ? lines : lines.slice(0, end);
}

function commandNames(text) {
  return section(text, "Commands")
    .map((line) => /^ {2}([a-z][\w-]*)/.exec(line)?.[1])
    .filter(Boolean);
}

function flagNames(text) {
  const lines = [...section(text, "Options"), ...section(text, "Global Options")];
  return new Set(
    lines.flatMap((line) => [...line.matchAll(/(?:^|[\s,])(--[a-z][\w-]*)/g)].map((m) => m[1])),
  );
}

function loadCommandTable() {
  if (!existsSync(cliBin)) {
    console.error(`${relative(root, cliBin)} is missing; run npm run build first.`);
    process.exit(1);
  }
  const table = new Map();
  for (const top of commandNames(help([]))) {
    const topHelp = help([top]);
    const verbs = commandNames(topHelp);
    table.set(top, { flags: flagNames(topHelp), verbs: new Map() });
    for (const verb of verbs) table.get(top).verbs.set(verb, flagNames(help([top, verb])));
  }
  return table;
}

function codeSpans(text) {
  const spans = [];
  const fenced = /^```[^\n]*\n([\s\S]*?)^```/gm;
  for (const [, block] of text.matchAll(fenced)) spans.push(...block.split("\n"));
  const prose = text.replace(fenced, "");
  for (const [, inline] of prose.matchAll(/`([^`\n]+)`/g)) spans.push(inline);
  return spans;
}

function checkCommands(file, text, table) {
  for (const span of codeSpans(text)) {
    for (const match of span.matchAll(/(?<![\w@/.-])alttext\b(?![\w.-])/g)) {
      const rest = span.slice(match.index + "alttext".length);
      const segment = rest.split(/\||&&|;|\)|>|<|`/)[0];
      const tokens = segment.trim().split(/\s+/).filter(Boolean);
      const words = [];
      for (const token of tokens) {
        if (!/^[a-z][\w-]*$/.test(token)) break;
        words.push(token);
      }
      if (words.length === 0) continue;
      const [noun, verb] = words;
      const entry = table.get(noun);
      if (!entry) {
        fail(file, `unknown command "alttext ${noun}" in: ${span.trim()}`);
        continue;
      }
      let flags = entry.flags;
      if (entry.verbs.size > 0 && verb !== undefined) {
        if (!entry.verbs.has(verb)) {
          fail(file, `unknown command "alttext ${noun} ${verb}" in: ${span.trim()}`);
          continue;
        }
        flags = entry.verbs.get(verb);
      }
      for (const token of tokens) {
        const flag = /^(--[a-z][\w-]*)/.exec(token)?.[1];
        if (flag && !flags.has(flag)) {
          fail(
            file,
            `"alttext ${words.slice(0, 2).join(" ")}" has no ${flag} flag, in: ${span.trim()}`,
          );
        }
      }
    }
  }
}

function checkMarketplace() {
  const file = join(root, ".claude-plugin/marketplace.json");
  if (!existsSync(file)) return;
  let marketplace;
  try {
    marketplace = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(file, `invalid JSON: ${error.message}`);
    return;
  }
  if (!marketplace.name) fail(file, "needs a name");
  if (!marketplace.owner?.name) fail(file, "needs owner.name");
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    fail(file, "needs a non-empty plugins array");
    return;
  }
  for (const plugin of marketplace.plugins) {
    if (!plugin.name || !plugin.source) fail(file, "each plugin needs a name and a source");
    if (typeof plugin.source !== "string") continue;
    const base = resolve(root, plugin.source);
    if (!existsSync(base)) fail(file, `plugin ${plugin.name} source is missing: ${plugin.source}`);
    for (const skill of plugin.skills ?? []) {
      if (!existsSync(join(resolve(base, skill), "SKILL.md"))) {
        fail(file, `plugin ${plugin.name} lists a skill with no SKILL.md: ${skill}`);
      }
    }
  }
}

const table = loadCommandTable();
const skills = readdirSync(skillsDir).filter((entry) =>
  statSync(join(skillsDir, entry)).isDirectory(),
);
if (skills.length === 0) fail(skillsDir, "contains no skills");

for (const skillName of skills) {
  const skillFile = join(skillsDir, skillName, "SKILL.md");
  if (!existsSync(skillFile)) {
    fail(join(skillsDir, skillName), "has no SKILL.md");
    continue;
  }
  const parsed = parseFrontmatter(skillFile, readFileSync(skillFile, "utf8"));
  if (parsed) {
    checkFrontmatter(skillFile, skillName, parsed.fields);
    if (parsed.body.trim() === "") fail(skillFile, "has no instructions after the frontmatter");
  }
  for (const file of markdownFiles(join(skillsDir, skillName))) {
    const text = readFileSync(file, "utf8");
    checkLinks(file, text);
    checkCommands(file, text, table);
  }
}
checkMarketplace();

if (errors.length > 0) {
  console.error(errors.join("\n"));
  console.error(`\n${String(errors.length)} skill problem(s) found.`);
  process.exit(1);
}
console.log(`Validated ${String(skills.length)} skill(s) against the alttext CLI.`);
