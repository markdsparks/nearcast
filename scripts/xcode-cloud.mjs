#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API_BASE = "https://api.appstoreconnect.apple.com/v1";

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...valueParts] = item.slice(2).split("=");
    args[key] = valueParts.length ? valueParts.join("=") : "true";
  }
  return args;
}

function usage() {
  console.error(`Usage:
  node scripts/xcode-cloud.mjs list --key-id=KEY --issuer-id=ISSUER --key-file=PATH
  node scripts/xcode-cloud.mjs trigger --workflow-name=Default --key-id=KEY --issuer-id=ISSUER --key-file=PATH
  node scripts/xcode-cloud.mjs status --build-id=ID --key-id=KEY --issuer-id=ISSUER --key-file=PATH
  node scripts/xcode-cloud.mjs actions --build-id=ID --key-id=KEY --issuer-id=ISSUER --key-file=PATH
  node scripts/xcode-cloud.mjs issues --action-id=ID --key-id=KEY --issuer-id=ISSUER --key-file=PATH

Environment fallbacks:
  ASC_KEY_ID
  ASC_ISSUER_ID
  ASC_KEY_FILE
  ASC_BUNDLE_ID       defaults to app.nearcast.ios
`);
}

function required(value, name) {
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt({ keyId, issuerId, keyFile }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: issuerId,
    iat: now - 30,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1"
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = fs.readFileSync(path.resolve(keyFile), "utf8");
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  });
  return `${signingInput}.${base64url(signature)}`;
}

async function apiRequest(client, endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${client.token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const detail = body?.errors?.map((error) => `${error.status || response.status} ${error.title || ""} ${error.detail || ""}`.trim()).join("; ");
    throw new Error(`${options.method || "GET"} ${endpoint} failed: ${detail || response.statusText}`);
  }
  return body;
}

function workflowName(item) {
  return item?.attributes?.name || item?.attributes?.description || item?.id;
}

async function findNearcastApp(client, bundleId) {
  const encoded = encodeURIComponent(bundleId);
  const apps = await apiRequest(client, `/apps?filter[bundleId]=${encoded}`);
  const app = apps.data?.[0];
  if (!app) throw new Error(`No App Store Connect app found for bundle id ${bundleId}`);
  return app;
}

async function listProducts(client, appId) {
  const attempts = [
    `/ciProducts?filter[app]=${encodeURIComponent(appId)}`,
    `/ciProducts`
  ];
  let lastError = null;
  for (const endpoint of attempts) {
    try {
      const response = await apiRequest(client, endpoint);
      return response.data || [];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function listWorkflows(client, productId) {
  const attempts = productId
    ? [
        `/ciWorkflows?filter[product]=${encodeURIComponent(productId)}`,
        `/ciWorkflows?filter[ciProduct]=${encodeURIComponent(productId)}`,
        `/ciProducts/${encodeURIComponent(productId)}/workflows`,
        `/ciWorkflows`
      ]
    : ["/ciWorkflows"];
  let lastError = null;
  for (const endpoint of attempts) {
    try {
      const response = await apiRequest(client, endpoint);
      return response.data || [];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function triggerWorkflow(client, workflowId) {
  const body = {
    data: {
      type: "ciBuildRuns",
      relationships: {
        workflow: {
          data: {
            type: "ciWorkflows",
            id: workflowId
          }
        }
      }
    }
  };
  return apiRequest(client, "/ciBuildRuns", { method: "POST", body });
}

function printWorkflowSummary(app, products, workflows) {
  console.log(`App: ${app.attributes?.name || app.id} (${app.id})`);
  console.log(`Products: ${products.length}`);
  for (const product of products) {
    console.log(`- ${product.id}: ${product.attributes?.name || product.attributes?.productType || "Xcode Cloud product"}`);
  }
  console.log(`Workflows: ${workflows.length}`);
  for (const workflow of workflows) {
    const attrs = workflow.attributes || {};
    console.log(`- ${workflowName(workflow)} | id=${workflow.id} | clean=${attrs.clean ?? ""} | enabled=${attrs.isEnabled ?? ""}`);
  }
}

async function main() {
  const [command = "list", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (args.help || command === "help") {
    usage();
    return;
  }

  const keyId = required(args["key-id"] || process.env.ASC_KEY_ID, "ASC key id");
  const issuerId = required(args["issuer-id"] || process.env.ASC_ISSUER_ID, "ASC issuer id");
  const keyFile = required(args["key-file"] || process.env.ASC_KEY_FILE, "ASC key file");
  const bundleId = args["bundle-id"] || process.env.ASC_BUNDLE_ID || "app.nearcast.ios";
  const client = {
    token: createJwt({ keyId, issuerId, keyFile })
  };

  if (command === "status") {
    const buildId = required(args["build-id"], "build id");
    const build = await apiRequest(client, `/ciBuildRuns/${encodeURIComponent(buildId)}`);
    console.log(JSON.stringify(build.data, null, 2));
    return;
  }

  if (command === "actions") {
    const buildId = required(args["build-id"], "build id");
    const actions = await apiRequest(client, `/ciBuildRuns/${encodeURIComponent(buildId)}/actions`);
    console.log(JSON.stringify(actions.data || [], null, 2));
    return;
  }

  if (command === "issues") {
    const actionId = required(args["action-id"], "action id");
    const issues = await apiRequest(client, `/ciBuildActions/${encodeURIComponent(actionId)}/issues`);
    console.log(JSON.stringify(issues.data || [], null, 2));
    return;
  }

  const app = await findNearcastApp(client, bundleId);
  const products = await listProducts(client, app.id);
  const product = products[0];
  const workflows = await listWorkflows(client, product?.id);

  if (command === "list") {
    printWorkflowSummary(app, products, workflows);
    return;
  }

  if (command === "trigger") {
    const requestedName = args["workflow-name"] || process.env.ASC_WORKFLOW_NAME || "Default";
    const workflow = workflows.find((item) => workflowName(item) === requestedName)
      || workflows.find((item) => workflowName(item)?.toLowerCase().includes(requestedName.toLowerCase()))
      || workflows[0];
    if (!workflow) throw new Error("No Xcode Cloud workflow found to trigger");
    const result = await triggerWorkflow(client, workflow.id);
    console.log(`Triggered workflow: ${workflowName(workflow)} (${workflow.id})`);
    console.log(`Build run: ${result.data?.id}`);
    console.log(JSON.stringify(result.data?.attributes || {}, null, 2));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
