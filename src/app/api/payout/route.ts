import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { ensureRealSchema, payoutAddressFor } from "@/lib/real-deal";
import { isSolanaAddress } from "@/lib/solana-verify";

/** The seller's Solana payout address for real USDC settlement. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json({ solana: await payoutAddressFor(user.id) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const solana = String(b?.solana ?? "").trim();
  if (!isSolanaAddress(solana)) return Response.json({ error: "Enter a valid Solana address (base58 public key)." }, { status: 400 });
  await ensureRealSchema();
  await db()`INSERT INTO bb_payout_wallets(user_id,solana_address,updated_at) VALUES(${String(user.id)},${solana},now())
    ON CONFLICT (user_id) DO UPDATE SET solana_address=EXCLUDED.solana_address, updated_at=now()`;
  return Response.json({ solana });
}
