import { createClient } from "@1claw/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { workerAuthorized } from "@/lib/real-deal";
import { VAULT_PATHS, oneclawConfigured, type SecretName } from "@/lib/vault";
import { KITE_AGENTS } from "@/lib/identity";
import { keypairFromSecret, parseSolanaSecret } from "@/lib/anchor-solana";
import { BLACKBOX_ANCHOR_SOLANA } from "@/lib/solana-memo";


const LEGACY: Record<SecretName, string> = {
  serv: "SERV_API_KEY",
  buyer: "BLACKBOX_BUYER_AGENT_KEY",
  seller: "BLACKBOX_SELLER_AGENT_KEY",
  anchor: "ANCHOR_SOLANA_SECRET_KEY",
};

/**
 * One-time, operator-only move of the old env secrets into 1Claw, server to server, so no person or agent ever
 * copies a value by hand. Each key is checked against its published address before it is written. Only works
 * while the agent's 1Claw policy grants write on blackbox/*; after the move the policy is cut back to read.
 */
export async function POST(req: Request) {
  if (!workerAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!oneclawConfigured()) return Response.json({ error: "1Claw is not configured" }, { status: 400 });
  const c = createClient({ baseUrl: "https://api.1claw.co", apiKey: process.env.ONECLAW_AGENT_API_KEY!.trim(), agentId: process.env.ONECLAW_AGENT_ID!.trim() });
  const vault = process.env.ONECLAW_VAULT_ID!.trim();
  const results: Record<string, unknown> = {};
  for (const name of Object.keys(VAULT_PATHS) as SecretName[]) {
    const v = process.env[LEGACY[name]]?.trim();
    if (!v) { results[name] = { skipped: "env var not set" }; continue; }
    try {
      if (name === "buyer" || name === "seller") {
        const addr = privateKeyToAccount((v.startsWith("0x") ? v : `0x${v}`) as `0x${string}`).address;
        if (addr.toLowerCase() !== KITE_AGENTS[name].runtimeKey.toLowerCase()) { results[name] = { skipped: "key does not match registered runtime address" }; continue; }
      }
      if (name === "anchor" && keypairFromSecret(parseSolanaSecret(v)).address !== BLACKBOX_ANCHOR_SOLANA) { results[name] = { skipped: "key does not match anchor wallet" }; continue; }
    } catch { results[name] = { skipped: "malformed" }; continue; }
    const { error, meta } = await c.secrets.set(vault, VAULT_PATHS[name], v, { type: name === "serv" ? "api_key" : "private_key", metadata: { app: "blackbox", migrated_from: LEGACY[name] } });
    results[name] = error ? { ok: false, status: meta?.status, error: error.type, message: error.message } : { ok: true, status: meta?.status, path: VAULT_PATHS[name] };
  }
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
