#!/usr/bin/env node
/**
 * Grant (or tighten) the 1Claw agent's access to Blackbox's secret paths. Run by the vault owner, not the app.
 *
 *   ONECLAW_API_KEY=1ck_... ONECLAW_VAULT_ID=... ONECLAW_AGENT_ID=... node scripts/oneclaw-policy.mjs grant-migrate
 *   ... node scripts/oneclaw-policy.mjs lock <policy-id>      # cut the grant back to read-only
 *
 * The human key never goes into the app. Prints ids and statuses only, never a secret.
 * Each run costs exactly one 1Claw API call.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@1claw/sdk";

const keyFile = process.env.ONECLAW_API_KEY_FILE;
const key = (process.env.ONECLAW_API_KEY || (keyFile && existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "")).trim();
const vault = process.env.ONECLAW_VAULT_ID?.trim();
const agent = process.env.ONECLAW_AGENT_ID?.trim();
if (!key.startsWith("1ck_") || !vault || !agent) {
  console.error("Need ONECLAW_API_KEY (or ONECLAW_API_KEY_FILE), ONECLAW_VAULT_ID and ONECLAW_AGENT_ID.");
  process.exit(1);
}
// A 1ck_ key is accepted as a bearer token as-is, which skips the extra token-exchange call.
const c = createClient({ baseUrl: "https://api.1claw.co", token: key });
const [mode, policyId] = process.argv.slice(2);

if (mode === "grant-migrate" || mode === "grant") {
  const perms = mode === "grant" ? ["read"] : ["read", "write"];
  const { data, error, meta } = await c.access.grantAgent(vault, agent, perms, { secretPathPattern: "blackbox/*" });
  if (error) { console.error("grant failed:", meta?.status, error.type, error.message); process.exit(1); }
  console.log("granted", perms.join("+"), "on blackbox/* · policy", data?.id, "· status", meta?.status);
} else if (mode === "lock" && policyId) {
  const { error, meta } = await c.access.update(vault, policyId, { permissions: ["read"], effect: "allow", priority: 0 });
  if (error) { console.error("lock failed:", meta?.status, error.type, error.message); process.exit(1); }
  console.log("policy", policyId, "is now read-only · status", meta?.status);
} else {
  console.error("usage: grant-migrate | grant | lock <policy-id>");
  process.exit(1);
}
