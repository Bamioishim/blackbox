import { privateKeyToAccount } from "viem/accounts";
import { workerAuthorized } from "@/lib/real-deal";
import { getSecret, oneclawConfigured, vaultManaged, callsThisMonth, type SecretName } from "@/lib/vault";
import { KITE_AGENTS } from "@/lib/identity";
import { keypairFromSecret, parseSolanaSecret } from "@/lib/anchor-solana";
import { BLACKBOX_ANCHOR_SOLANA } from "@/lib/solana-memo";


/**
 * Operator-only health check: pulls each Blackbox secret from 1Claw and proves it is the right one by deriving its
 * public address. Returns booleans and public addresses only, never a value. Costs up to 1 token + 4 GETs.
 */
export async function GET(req: Request) {
  if (!workerAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!oneclawConfigured()) return Response.json({ configured: false });
  const out: Record<string, unknown> = {};
  const one = async (name: SecretName, check: (v: string) => unknown) => {
    try {
      const v = await getSecret(name);
      const source = vaultManaged(name) ? "1claw" : "env";
      out[name] = v ? { source, ...(check(v) as object) } : { source, ok: false, error: "empty" };
    } catch (e) {
      out[name] = { ok: false, error: (e as Error).message };
    }
  };
  await one("serv", (v) => ({ ok: v.length > 16 }));
  for (const side of ["buyer", "seller"] as const) {
    await one(side, (v) => {
      const hex = (v.trim().startsWith("0x") ? v.trim() : `0x${v.trim()}`) as `0x${string}`;
      const addr = privateKeyToAccount(hex).address;
      return { ok: addr.toLowerCase() === KITE_AGENTS[side].runtimeKey.toLowerCase(), address: addr };
    });
  }
  await one("anchor", (v) => {
    const addr = keypairFromSecret(parseSolanaSecret(v)).address;
    return { ok: addr === BLACKBOX_ANCHOR_SOLANA, address: addr };
  });
  return Response.json({ configured: true, ...out, callsThisMonth: await callsThisMonth() }, { headers: { "Cache-Control": "no-store" } });
}
