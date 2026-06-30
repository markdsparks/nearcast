#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function main() {
  const command = args._[0];
  if (command === "scan-failed") {
    writeScanFailed(args.selection || "/tmp/radar-generation-plan-selection.json");
    return;
  }
  if (command === "normalize") {
    normalizeSelection({
      selectionPath: args.selection || "/tmp/radar-generation-plan-selection.json",
      planPath: args.plan || "/tmp/radar-generation-plan.json"
    });
    return;
  }
  printHelp();
  process.exit(command ? 1 : 0);
}

function writeScanFailed(selectionPath) {
  writeJson(selectionPath, {
    provider: "nearcast-radar-generation-plan-selection",
    version: 1,
    selected: false,
    reason: "plan-store-scan-failed",
    pointerPath: process.env.POINTER_PATH || "",
    skipped: []
  });
}

function normalizeSelection({ selectionPath, planPath }) {
  const selection = readJson(selectionPath);
  if (!selection.selected) {
    writeJson(selectionPath, {
      ...selection,
      pointerPath: process.env.POINTER_PATH || ""
    });
    return;
  }

  const plan = readJson(planPath);
  const suppressedReasons = String(process.env.SUPPRESSED_PLAN_REASONS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const planReason = String(plan.reason || "");

  if (suppressedReasons.includes(planReason)) {
    writeJson(selectionPath, {
      ...selection,
      selected: false,
      reason: "pending-plan-suppressed-reason",
      requestId: plan.requestId || selection.requestId,
      dedupeKey: plan.dedupeKey || selection.dedupeKey,
      pointerPath: process.env.POINTER_PATH || "",
      skipped: [
        ...(Array.isArray(selection.skipped) ? selection.skipped : []),
        { planKey: selection.planKey, status: "suppressed", reason: planReason }
      ]
    });
    return;
  }

  writeJson(selectionPath, {
    ...selection,
    pointerPath: process.env.POINTER_PATH || "",
    requestId: plan.requestId || selection.requestId,
    dedupeKey: plan.dedupeKey || selection.dedupeKey
  });
}

function parseArgs(argv) {
  const parsed = { _: [] };
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      return;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) parsed[body] = true;
    else parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  });
  return parsed;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/radar-generation-plan-selection.mjs scan-failed --selection=/tmp/selection.json
  node scripts/radar-generation-plan-selection.mjs normalize --selection=/tmp/selection.json --plan=/tmp/plan.json
`);
}
