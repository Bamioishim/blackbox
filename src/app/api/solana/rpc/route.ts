import { forwardSolanaRpc } from "@/lib/solana-verify";

/**
 * Same-origin Solana mainnet RPC proxy for the public verifier.
 * Only getTransaction and getSignatureStatuses for valid signatures.
 * The browser still checks mint, amount and recipient itself.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { method?: unknown; params?: unknown; id?: unknown } | null;
  if (!b) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }, { status: 400 });
  const forwarded = await forwardSolanaRpc(String(b.method ?? ""), Array.isArray(b.params) ? b.params : [], {});
  if (!forwarded.ok) {
    return Response.json({ jsonrpc: "2.0", id: b.id ?? 1, error: { code: forwarded.status === 400 ? -32600 : -32603, message: forwarded.error } }, { status: forwarded.status });
  }
  return Response.json({ jsonrpc: "2.0", id: b.id ?? 1, result: forwarded.result }, { headers: { "Cache-Control": "no-store" } });
}
