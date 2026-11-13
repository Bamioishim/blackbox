#!/usr/bin/env node
/**
 * Blackbox settlement worker: turns a real-settlement request into a Kite Passport wallet send.
 *
 * Runs on the operator's machine, where `kpass` is installed and signed in. The Vercel app never
 * sees Kite credentials. For each deal waiting for payment it:
 *   1. checks the request (recipient must equal --expect-to, amount <= --max, USDC on Solana);
 *   2. runs `kpass wallet send` for exactly the agreed amount and posts the passkey approval link
 *      back to the app (the buyer sees an "Approve in Kite Passport" button on the deal);
 *   3. polls `kpass wallet send-status` (no --wait) until the owner approves, then posts the
 *      transaction signature; the app verifies it on Solana mainnet before marking the deal settled.
 *
 * Usage:
 *   node scripts/settle-worker.mjs --expect-to <SOLANA_ADDRESS> [--max 1] [--url https://blackbox-serv.vercel.app]
 *        [--secret-file /workspace/secrets/blackbox-settle-worker.txt] [--dry-run] [--once]
 *   node scripts/settle-worker.mjs --list            # show waiting payments and exit
 *   node scripts/settle-worker.mjs --cancel <id>     # cancel a waiting payment (nothing is sent)
 *
 * Never prints the worker secret. --dry-run never calls `kpass wallet send`.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

const BASE = opt("url", process.env.BLACKBOX_URL || "https://blackbox-serv.vercel.app").replace(/\/$/, "");
const SECRET_FILE = opt("secret-file", "/workspace/secrets/blackbox-settle-worker.txt");
const EXPECT_TO = opt("expect-to", "");
const MAX = Number(opt("max", "1"));
const DRY = flag("dry-run");
const ONCE = flag("once");
const MAX_LINKS = Number(opt("max-links", "3"));
const STATUS_FILE = opt("status-file", "/workspace/blackbox-settle-status.json");
const KPASS = opt("kpass", "kpass");

const secret = (process.env.SETTLEMENT_WORKER_SECRET || readFileSync(SECRET_FILE, "utf8")).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false }) + " WAT";
const log = (...a) => console.log(`[${now()}]`, ...a);

function status(obj) {
  try { writeFileSync(STATUS_FILE, JSON.stringify({ at: new Date().toISOString(), ...obj }, null, 2)); } catch {}
}

async function api(method, body) {
  const res = await fetch(`${BASE}/api/settlement/worker`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ...j };
}

function kpass(argv) {
  return new Promise((resolve) => {
    execFile(KPASS, [...argv, "--output", "json", "--no-interactive"], { timeout: 60_000 }, (err, stdout, stderr) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch { const m = String(stdout).match(/\{[\s\S]*\}/); if (m) try { json = JSON.parse(m[0]); } catch {} }
      resolve({ code: err ? (err.code ?? 1) : 0, json, stderr: String(stderr || "").trim() });
    });
  });
}

function guard(p) {
  if (p.chain !== "solana" || p.asset !== "USDC") return `not USDC on Solana (${p.asset} on ${p.chain})`;
  if (!EXPECT_TO) return "no --expect-to address given";
  if (p.recipient !== EXPECT_TO) return `recipient ${p.recipient} is not the expected payout address`;
  const a = Number(p.amount);
  if (!Number.isFinite(a) || a <= 0 || a > MAX + 1e-9) return `amount ${p.amount} is above --max ${MAX}`;
  return null;
}

async function confirm(p, signature, requestId) {
  for (let i = 0; i < 40; i++) {
    const r = await api("POST", { id: p.id, action: "confirm", signature, kiteRequestId: requestId });
    if (r.ok) {
      log(`SETTLED ✔ ${p.amount} USDC → ${p.recipient}`);
      log(`  tx https://solscan.io/tx/${signature}`);
      status({ state: "settled", paymentId: p.id, dealId: p.deal_id, amount: p.amount, signature, explorer: `https://solscan.io/tx/${signature}` });
      return true;
    }
    if (!r.retry) { log(`Server refused the transaction: ${r.error}`); status({ state: "confirm_refused", paymentId: p.id, signature, error: r.error }); return false; }
    log(`Waiting for Solana confirmation… (${r.error})`);
    await sleep(3000);
  }
  log("Gave up waiting for the server to verify the transaction. Re-run the worker to retry.");
  return false;
}

/** Poll one Kite request until success / expiry. Returns "settled" | "expired" | "failed". */
async function follow(p, requestId, approvalUrl) {
  let lastPrint = 0;
  for (;;) {
    const r = await kpass(["wallet", "send-status", "--request-id", requestId]);
    const j = r.json || {};
    if (j.status === "success" && j.transaction_hash) {
      log(`Kite Passport: payment approved. tx ${j.transaction_hash}`);
      return (await confirm(p, j.transaction_hash, requestId)) ? "settled" : "failed";
    }
    if (j.status === "pending" || (r.code === 1 && !j.status)) {
      if (Date.now() - lastPrint > 15000) { log(`Waiting for passkey approval… ${approvalUrl ?? ""}`); lastPrint = Date.now(); }
      await sleep(4000);
      continue;
    }
    const msg = j.error || j.hint || r.stderr || `exit ${r.code}`;
    if (/expired/i.test(msg)) return "expired";
    log(`Kite Passport: send did not go through (${msg}).`);
    await api("POST", { id: p.id, action: "failed", reason: `Kite Passport: ${msg}` });
    status({ state: "failed", paymentId: p.id, error: msg });
    return "failed";
  }
}

async function handle(p) {
  const bad = guard(p);
  if (bad) { log(`SKIP payment ${p.id}: ${bad}`); return; }
  if (p.status === "awaiting_approval" && p.kite_request_id) {
    log(`Resuming Kite request ${p.kite_request_id} for deal ${p.deal_id}`);
    const out = await follow(p, p.kite_request_id, null);
    if (out === "expired") await api("POST", { id: p.id, action: "expired", reason: "Approval link expired; creating a new one." });
    return;
  }
  for (let attempt = Number(p.attempts || 0) + 1; attempt <= MAX_LINKS; attempt++) {
    if (DRY) {
      log(`DRY RUN: would run: kpass wallet send --chain solana --to ${p.recipient} --amount ${Number(p.amount)} --asset USDC --idempotency-key blackbox-${p.id}-${attempt}`);
      status({ state: "dry_run", paymentId: p.id, dealId: p.deal_id, amount: p.amount, recipient: p.recipient });
      return;
    }
    log(`Creating Kite Passport payment: ${p.amount} USDC on Solana → ${p.recipient} (deal ${p.deal_id}, link ${attempt}/${MAX_LINKS})`);
    const r = await kpass(["wallet", "send", "--chain", "solana", "--to", p.recipient, "--amount", String(Number(p.amount)), "--asset", "USDC", "--idempotency-key", `blackbox-${p.id}-${attempt}`]);
    const j = r.json || {};
    if (j.status === "success" && j.transaction_hash) { await confirm(p, j.transaction_hash, j.request_id); return; }
    if (j.status !== "human_action_required" || !j.approval_url || !j.request_id) {
      const msg = j.error || j.error_code || j.hint || r.stderr || `exit ${r.code}`;
      log(`kpass wallet send failed: ${msg}`);
      await api("POST", { id: p.id, action: "failed", reason: `Kite Passport: ${msg}` });
      status({ state: "failed", paymentId: p.id, error: msg });
      return;
    }
    const posted = await api("POST", { id: p.id, action: "approval", approvalUrl: j.approval_url, kiteRequestId: j.request_id, expiresAt: j.expires_at });
    if (!posted.ok) log(`Warning: app did not accept the approval link (${posted.error}).`);
    try { writeFileSync("/workspace/blackbox-approval-link.txt", j.approval_url + "\n"); } catch {}
    status({ state: "awaiting_approval", paymentId: p.id, dealId: p.deal_id, amount: p.amount, recipient: p.recipient, approvalUrl: j.approval_url, kiteRequestId: j.request_id });
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🛡️  APPROVE IN KITE PASSPORT (passkey)");
    console.log(`🌐 ${j.approval_url}`);
    console.log(`📤 ${p.amount} USDC · solana → ${p.recipient}`);
    console.log(`📋 ${j.request_id}`);
    console.log("Also shown on the deal as “Approve in Kite Passport”. The link expires in about 1–2 minutes.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    const out = await follow(p, j.request_id, j.approval_url);
    if (out !== "expired") return;
    log("Approval link expired before it was approved.");
    await api("POST", { id: p.id, action: "expired", reason: "Approval link expired; creating a new one." });
  }
  log(`No approval after ${MAX_LINKS} links. Marking the payment as not made.`);
  await api("POST", { id: p.id, action: "failed", reason: `Not approved after ${MAX_LINKS} approval links. No funds moved.` });
  status({ state: "failed", paymentId: p.id, error: "not approved" });
}

async function main() {
  if (flag("cancel")) {
    const id = opt("cancel");
    const r = await api("POST", { id, action: "cancel", reason: "Cancelled by the operator. No funds moved." });
    log(JSON.stringify({ cancelled: r.ok, status: r.status }));
    return;
  }
  if (flag("list")) {
    const q = await api("GET");
    if (q.status !== 200) { log(`queue error ${q.status}: ${q.error}`); process.exit(1); }
    console.log(JSON.stringify(q.payments, null, 2));
    return;
  }
  if (!EXPECT_TO) { console.error("Pass --expect-to <seller Solana payout address>. The worker refuses any other recipient."); process.exit(2); }
  log(`Settlement worker on ${BASE} · expects payout ${EXPECT_TO} · max ${MAX} USDC${DRY ? " · DRY RUN (no kpass send)" : ""}`);
  status({ state: "watching", url: BASE, expectTo: EXPECT_TO, max: MAX, dryRun: DRY });
  const seen = new Set();
  for (;;) {
    const q = await api("GET");
    if (q.status !== 200) { log(`queue error ${q.status}: ${q.error ?? ""}`); if (q.status === 401) process.exit(1); }
    for (const p of q.payments ?? []) {
      if (DRY && seen.has(p.id)) continue;
      seen.add(p.id);
      await handle(p);
    }
    if (ONCE) return;
    await sleep(3000);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
