#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_DATASET = "nearcast_product_events";
export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 90;

const FUNNEL_STAGES = [
  ["Plan suggestion shown", "plan-invite-shown"],
  ["Plan suggestion opened", "plan-invite-open"],
  ["Plan Check started", "plan-check-started"],
  ["Plan confirmed", "plan-check-confirmed"],
  ["Plan Check completed", "plan-check-completed"],
  ["Plan watched", "plan-watched"],
  ["Notifications requested", "notification-opt-in"],
  ["Delivery ready", "notification-registration-ready"],
  ["Notification opened", "notification-open"],
  ["Change reviewed", "watch-change-reviewed"]
];

const TRUST_LOOP_EVENTS = new Set([
  "plan-invite-dismiss",
  ...FUNNEL_STAGES.map(([, event]) => event),
  "notification-registration-failed",
  "watching-open"
]);

export function validateDataset(value) {
  const dataset = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(dataset)) {
    throw new Error("dataset must start with a letter or underscore and contain only letters, numbers, and underscores (128 characters maximum)");
  }
  return dataset;
}

export function validateDays(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  const days = Number(text);
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  return days;
}

export function validateAccountId(value) {
  const accountId = String(value || "").trim();
  if (!/^[a-fA-F0-9]{32}$/.test(accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account id");
  }
  return accountId;
}

export function parseArgs(argv = []) {
  const options = { dataset: DEFAULT_DATASET, days: DEFAULT_DAYS, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const equals = argument.match(/^--(days|dataset)=(.*)$/s);
    if (equals) {
      options[equals[1]] = equals[2];
      continue;
    }
    const name = argument.match(/^--(days|dataset)$/)?.[1];
    if (name) {
      if (index + 1 >= argv.length) throw new Error(`missing value for --${name}`);
      options[name] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return {
    dataset: validateDataset(options.dataset),
    days: validateDays(options.days),
    help: options.help
  };
}

export function buildQuery(dataset, days) {
  const safeDataset = validateDataset(dataset);
  const safeDays = validateDays(days);
  return `SELECT
  blob1 AS event,
  blob2 AS platform,
  blob3 AS version,
  SUM(_sample_interval * double1) AS event_count
FROM ${safeDataset}
WHERE timestamp >= NOW() - INTERVAL '${safeDays}' DAY
GROUP BY event, platform, version
ORDER BY event_count DESC
LIMIT 10000
FORMAT JSON`;
}

export function parseSqlResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cloudflare SQL API returned an invalid JSON response");
  }
  if (!Array.isArray(value.meta) || !Array.isArray(value.data) || !Number.isInteger(value.rows)) {
    throw new Error("Cloudflare SQL API response is missing meta, data, or rows");
  }
  const columns = new Set(value.meta.map((column) => String(column?.name || "")));
  for (const column of ["event", "platform", "version", "event_count"]) {
    if (!columns.has(column)) throw new Error(`Cloudflare SQL API response is missing the ${column} column`);
  }
  if (value.rows !== value.data.length) {
    throw new Error(`Cloudflare SQL API row count mismatch (${value.rows} declared, ${value.data.length} returned)`);
  }
  return value.data.map((row, index) => {
    const count = Number(row?.event_count);
    if (!row || typeof row !== "object" || !Number.isFinite(count) || count < 0) {
      throw new Error(`Cloudflare SQL API returned an invalid aggregate at row ${index + 1}`);
    }
    return {
      event: String(row.event || "unknown"),
      platform: String(row.platform || "unknown"),
      version: String(row.version || "unknown"),
      count
    };
  });
}

function sumBy(rows, key) {
  const totals = new Map();
  for (const row of rows) {
    const value = String(row[key] || "unknown");
    totals.set(value, (totals.get(value) || 0) + row.count);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatRate(numerator, denominator) {
  if (!(denominator > 0)) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format((numerator / denominator) * 100)}%`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function buildReport(rows, { dataset = DEFAULT_DATASET, days = DEFAULT_DAYS } = {}) {
  const safeDataset = validateDataset(dataset);
  const safeDays = validateDays(days);
  const trustRows = rows.filter((row) => TRUST_LOOP_EVENTS.has(row.event));
  const eventTotals = new Map(sumBy(trustRows, "event"));
  const platformTotals = sumBy(trustRows, "platform");
  const versionTotals = sumBy(trustRows, "version");
  const total = trustRows.reduce((sum, row) => sum + row.count, 0);
  const ready = eventTotals.get("notification-registration-ready") || 0;
  const failed = eventTotals.get("notification-registration-failed") || 0;

  const lines = [
    "# Nearcast Trust Loop report",
    "",
    `**Window:** last ${safeDays} day${safeDays === 1 ? "" : "s"} · **Dataset:** \`${safeDataset}\` · **Trust Loop events:** ${formatCount(total)}`,
    "",
    "Anonymous aggregate event volume—not unique people or cohort conversion. Counts include Cloudflare’s `_sample_interval` weighting.",
    "",
    "## Funnel",
    "",
    "| Stage | Events | vs. prior stage |",
    "| --- | ---: | ---: |"
  ];

  let prior = 0;
  for (const [label, event] of FUNNEL_STAGES) {
    const count = eventTotals.get(event) || 0;
    lines.push(`| ${escapeCell(label)} | ${formatCount(count)} | ${prior > 0 ? formatRate(count, prior) : "—"} |`);
    prior = count;
  }

  lines.push(
    "",
    `**Delivery registration:** ${formatRate(ready, ready + failed)} ready (${formatCount(ready)} ready · ${formatCount(failed)} failed)`,
    "",
    "## Platforms",
    "",
    "| Platform | Events | Share |",
    "| --- | ---: | ---: |"
  );
  if (!platformTotals.length) lines.push("| No data | 0 | — |");
  for (const [platform, count] of platformTotals) {
    lines.push(`| ${escapeCell(platform)} | ${formatCount(count)} | ${formatRate(count, total)} |`);
  }

  lines.push("", "## Versions", "", "| Version | Events | Share |", "| --- | ---: | ---: |");
  if (!versionTotals.length) lines.push("| No data | 0 | — |");
  for (const [version, count] of versionTotals.slice(0, 10)) {
    lines.push(`| ${escapeCell(version)} | ${formatCount(count)} | ${formatRate(count, total)} |`);
  }
  if (versionTotals.length > 10) {
    const other = versionTotals.slice(10).reduce((sum, [, count]) => sum + count, 0);
    lines.push(`| Other (${versionTotals.length - 10} versions) | ${formatCount(other)} | ${formatRate(other, total)} |`);
  }

  return `${lines.join("\n")}\n`;
}

function safeApiReason(text, token) {
  let reason = String(text || "").trim();
  try {
    const body = JSON.parse(reason);
    reason = body?.errors?.map((entry) => entry?.message).filter(Boolean).join("; ") ||
      body?.error || body?.message || "";
  } catch {
    // SQL errors can be plain text. Keep a short, single-line diagnostic.
  }
  reason = reason.replace(/[\r\n\t]+/g, " ").slice(0, 300);
  if (token) reason = reason.split(token).join("[redacted]");
  return reason;
}

function looksLikeAuthorizationFailure(status, reason) {
  return status === 401 || status === 403 ||
    /(?:not authorized|unauthorized|authentication|account analytics|permission denied|access denied|forbidden)/i.test(reason);
}

function analyticsAuthorizationError(status) {
  return new Error(`Cloudflare Analytics Engine authorization failed (HTTP ${status}). The token needs Account > Account Analytics > Read for this account.`);
}

export async function queryAnalytics({ accountId, token, dataset, days, fetchImpl = globalThis.fetch }) {
  const safeAccountId = validateAccountId(accountId);
  if (!String(token || "").trim()) {
    throw new Error("CLOUDFLARE_ANALYTICS_API_TOKEN is required (create it with Account > Account Analytics > Read)");
  }
  if (typeof fetchImpl !== "function") throw new Error("this Node runtime does not provide fetch");
  const query = buildQuery(dataset, days);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${safeAccountId}/analytics_engine/sql`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: query,
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw new Error(`Cloudflare Analytics Engine request failed: ${safeApiReason(error?.message, token) || "network error"}`);
  }
  const text = await response.text();
  const apiReason = safeApiReason(text, token);
  if (looksLikeAuthorizationFailure(response.status, apiReason)) throw analyticsAuthorizationError(response.status);
  if (!response.ok) {
    throw new Error(`Cloudflare Analytics Engine query failed (HTTP ${response.status})${apiReason ? `: ${apiReason}` : ""}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Cloudflare Analytics Engine returned non-JSON data for a FORMAT JSON query");
  }
  if (body?.success === false || (Array.isArray(body?.errors) && body.errors.length)) {
    const reason = safeApiReason(text, token);
    if (looksLikeAuthorizationFailure(response.status, reason)) throw analyticsAuthorizationError(response.status);
    throw new Error(`Cloudflare Analytics Engine query failed${reason ? `: ${reason}` : ""}`);
  }
  return parseSqlResponse(body);
}

export async function appendGitHubSummary(report, summaryPath) {
  if (!String(summaryPath || "").trim()) return false;
  await appendFile(summaryPath, report, "utf8");
  return true;
}

function usage() {
  return `Usage: node scripts/trust-loop-report.mjs [--days 7] [--dataset nearcast_product_events]

Environment:
  CLOUDFLARE_ACCOUNT_ID                 Cloudflare account id
  CLOUDFLARE_ANALYTICS_API_TOKEN        Token with Account Analytics Read
  GITHUB_STEP_SUMMARY                   Appended automatically when present
`;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const token = String(env.CLOUDFLARE_ANALYTICS_API_TOKEN || "").trim();
  const rows = await queryAnalytics({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token,
    dataset: options.dataset,
    days: options.days
  });
  const report = buildReport(rows, options);
  process.stdout.write(report);
  await appendGitHubSummary(report, env.GITHUB_STEP_SUMMARY);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    const token = String(process.env.CLOUDFLARE_ANALYTICS_API_TOKEN || "").trim();
    const message = safeApiReason(error?.message, token) || "unknown error";
    console.error(`Trust Loop report failed: ${message}`);
    process.exitCode = 1;
  });
}
