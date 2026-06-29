#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_LIMIT = 19500;
const DEFAULT_PATHS = [
  "radar/mrms/live",
  "radar/mrms/packs",
  "radar/mrms/manifest.json",
  "radar/mrms/index.json"
];

const args = parseArgs(process.argv.slice(2));

main();

function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const limit = Math.max(1, Math.round(numberArg(args.limit, DEFAULT_LIMIT)));
  const paths = splitList(args.paths).length ? splitList(args.paths) : DEFAULT_PATHS;
  const entries = paths.map((item) => ({
    path: item,
    files: countFiles(item)
  }));
  const totalFiles = entries.reduce((sum, entry) => sum + entry.files, 0);
  const summary = {
    provider: "nearcast-generated-radar-budget",
    limit,
    totalFiles,
    headroom: limit - totalFiles,
    paths: entries
  };

  console.log(JSON.stringify(summary, null, 2));
  if (totalFiles > limit) {
    console.error(`Generated MRMS assets use ${totalFiles} files, above the configured limit of ${limit}.`);
    process.exit(1);
  }
}

function countFiles(target) {
  if (!target) return 0;
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (stat.isFile()) return 1;
  if (!stat.isDirectory()) return 0;

  let count = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    for (const name of fs.readdirSync(current)) {
      const child = path.join(current, name);
      const childStat = fs.statSync(child);
      if (childStat.isDirectory()) stack.push(child);
      else if (childStat.isFile()) count += 1;
    }
  }
  return count;
}

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) parsed[body] = true;
    else parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  });
  return parsed;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/check-mrms-asset-budget.mjs --limit=19500

Options:
  --limit=19500             Maximum generated radar files allowed before deploy.
  --paths=a,b               Optional comma-separated paths to count.
`);
}
