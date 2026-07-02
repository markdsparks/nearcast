#!/usr/bin/env node

import { webcrypto } from "node:crypto";

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const keyPair = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const publicRaw = await webcrypto.subtle.exportKey("raw", keyPair.publicKey);
const privateJwk = await webcrypto.subtle.exportKey("jwk", keyPair.privateKey);

console.log("# VAPID public key: safe for wrangler.toml PLAN_WATCH_VAPID_PUBLIC_KEY");
console.log(base64Url(publicRaw));
console.log("");
console.log("# VAPID private JWK: store only as Cloudflare secret PLAN_WATCH_VAPID_PRIVATE_KEY");
console.log(JSON.stringify(privateJwk));
