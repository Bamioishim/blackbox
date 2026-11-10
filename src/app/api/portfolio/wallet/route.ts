import { createPublicClient, http, isAddress, parseUnits, verifyMessage } from "viem";
import { base } from "viem/chains";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
const erc721Abi = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const erc1155Abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const wallet = String(body?.walletAddress || "");
  const contract = String(body?.contractAddress || "");
  const type = String(body?.assetType || "");
  const tokenId = body?.tokenId == null ? "" : String(body.tokenId);
  const quantity = String(body?.quantity || "");
  const timestamp = Number(body?.timestamp);
  const signature = String(body?.signature || "");
  if (!isAddress(wallet) || !isAddress(contract) || !["token", "nft"].includes(type) || !signature || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) {
    return Response.json({ error: "Invalid wallet asset proof." }, { status: 400 });
  }
  const message = [
    "Blackbox wallet asset import", `user:${user.id}`, "chain:8453", `wallet:${wallet.toLowerCase()}`,
    `type:${type}`, `contract:${contract.toLowerCase()}`, `tokenId:${tokenId}`, `quantity:${quantity}`, `timestamp:${timestamp}`
  ].join("\n");
  try {
    if (!await verifyMessage({ address: wallet, message, signature: signature as `0x${string}` })) {
      return Response.json({ error: "Wallet signature did not verify." }, { status: 403 });
    }
    let name = "Onchain asset", symbol = "", verifiedQuantity = 0, unit = "";
    if (type === "token") {
      const [decimals, balance, tokenName, tokenSymbol] = await Promise.all([
        client.readContract({ address: contract, abi: erc20Abi, functionName: "decimals" }),
        client.readContract({ address: contract, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
        client.readContract({ address: contract, abi: erc20Abi, functionName: "name" }).catch(() => "Token"),
        client.readContract({ address: contract, abi: erc20Abi, functionName: "symbol" }).catch(() => ""),
      ]);
      const requested = parseUnits(quantity, Number(decimals));
      if (requested <= BigInt(0) || requested > balance) return Response.json({ error: "Wallet balance is lower than the quantity requested." }, { status: 409 });
      verifiedQuantity = Number(requested) / 10 ** Number(decimals);
      name = String(tokenName); symbol = String(tokenSymbol); unit = symbol || "tokens";
    } else {
      if (!tokenId || !/^\d+$/.test(tokenId)) return Response.json({ error: "NFT token ID is required." }, { status: 400 });
      const standard = String(body?.standard || "ERC-721");
      if (standard === "ERC-1155") {
        const balance = await client.readContract({ address: contract, abi: erc1155Abi, functionName: "balanceOf", args: [wallet, BigInt(tokenId)] });
        if (balance <= BigInt(0)) return Response.json({ error: "This wallet does not own that NFT quantity." }, { status: 409 });
        verifiedQuantity = Number(balance); name = String(body?.name || "ERC-1155 NFT"); unit = "units";
      } else {
        const owner = await client.readContract({ address: contract, abi: erc721Abi, functionName: "ownerOf", args: [BigInt(tokenId)] });
        if (owner.toLowerCase() !== wallet.toLowerCase()) return Response.json({ error: "This wallet does not own that NFT." }, { status: 409 });
        verifiedQuantity = 1; name = String(body?.name || "NFT"); unit = "item";
      }
      symbol = String(body?.symbol || "");
    }
    const sql = db();
    const metadata = { walletAddress: wallet, tokenId: tokenId || null, standard: String(body?.standard || (type === "token" ? "ERC-20" : "ERC-721")), chainId: 8453 };
    const existing = await sql`SELECT id FROM bb_assets WHERE owner_id=${user.id} AND contract_address=${contract} AND metadata->>'tokenId' IS NOT DISTINCT FROM ${tokenId || null} LIMIT 1`;
    if (existing.length) return Response.json({ error: "This wallet asset is already in your portfolio." }, { status: 409 });
    const rows = await sql`INSERT INTO bb_assets(owner_id,asset_type,symbol,name,quantity,unit,metadata,source,verified_ownership,chain,contract_address)
      VALUES (${user.id},${type},${symbol || null},${name},${verifiedQuantity},${unit},${JSON.stringify(metadata)}::jsonb,'wallet',true,'Base',${contract})
      RETURNING id,asset_type,symbol,name,quantity,reserved_quantity,unit,metadata,source,verified_ownership,chain,contract_address,created_at`;
    return Response.json({ asset: rows[0] }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message || "Could not verify this wallet asset on Base." }, { status: 502 });
  }
}
