import { isAddress } from "viem";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  if (!isAddress(address)) return Response.json({ error: "Enter a valid EVM address." }, { status: 400 });
  const base = "https://base.blockscout.com/api/v2/addresses/" + address;
  try {
    const [accountRes, tokensRes, nftRes] = await Promise.all([
      fetch(base, { cache: "no-store" }),
      fetch(base + "/token-balances", { cache: "no-store" }),
      fetch(base + "/nft", { cache: "no-store" }),
    ]);
    if (!accountRes.ok || !tokensRes.ok || !nftRes.ok) {
      return Response.json({ error: "Base portfolio provider is temporarily unavailable." }, { status: 502 });
    }
    const [account, tokens, nfts] = await Promise.all([accountRes.json(), tokensRes.json(), nftRes.json()]);
    return Response.json({
      chain: "Base",
      chainId: 8453,
      address,
      native: { name: "Ether", symbol: "ETH", balance: account.coin_balance || "0" },
      tokens: Array.isArray(tokens) ? tokens : [],
      nfts: Array.isArray(nfts?.items) ? nfts.items : [],
      source: "Base Blockscout",
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not load this wallet's Base portfolio." }, { status: 502 });
  }
}
