// Optional Kite testnet path (not used in production).
// Live anchoring is scripts/anchor-solana.mjs + src/lib/anchor-solana.ts (SPL Memo on Solana mainnet).
// This script deploys BlackboxAnchor to Kite AI testnet (once) and can anchor recorded deals.
//   node scripts/anchor.mjs deploy
//   node scripts/anchor.mjs anchor public/deals/deal_xxx.json
// The deployer key is read from ANCHOR_KEY_FILE (default /workspace/secrets/sealed_anchor_key). It is never printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createWalletClient, createPublicClient, http, defineChain, keccak256, toBytes, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const kite = defineChain({
  id: 2368, name: "Kite AI testnet", nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-testnet.gokite.ai/"] } },
  blockExplorers: { default: { name: "KiteScan", url: "https://testnet.kitescan.ai" } },
});
const EXPLORER = "https://testnet.kitescan.ai";
const keyFile = process.env.ANCHOR_KEY_FILE ?? "/workspace/secrets/sealed_anchor_key";
const account = privateKeyToAccount(readFileSync(keyFile, "utf8").trim());
const art = JSON.parse(readFileSync("contracts/BlackboxAnchor.json", "utf8"));
const pub = createPublicClient({ chain: kite, transport: http() });
const wallet = createWalletClient({ account, chain: kite, transport: http() });
const DEPLOY_FILE = "contracts/deployment.kite-testnet.json";

const [cmd, file] = process.argv.slice(2);
console.log("deployer", account.address, "balance", formatEther(await pub.getBalance({ address: account.address })), "KITE");

if (cmd === "deploy") {
  if (existsSync(DEPLOY_FILE)) { console.log("already deployed:", readFileSync(DEPLOY_FILE, "utf8")); process.exit(0); }
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode });
  const rc = await pub.waitForTransactionReceipt({ hash });
  const d = { chain: "Kite AI testnet", chainId: 2368, contract: rc.contractAddress, deployTx: hash, deployer: account.address, block: Number(rc.blockNumber), explorer: `${EXPLORER}/address/${rc.contractAddress}` };
  writeFileSync(DEPLOY_FILE, JSON.stringify(d, null, 2) + "\n");
  console.log("deployed", d.contract, `${EXPLORER}/tx/${hash}`);
} else if (cmd === "anchor") {
  const d = JSON.parse(readFileSync(DEPLOY_FILE, "utf8"));
  const r = JSON.parse(readFileSync(file, "utf8"));
  const dealKey = keccak256(toBytes(r.dealId));
  const existing = await pub.readContract({ address: d.contract, abi: art.abi, functionName: "anchors", args: [dealKey] });
  if (existing[2] !== 0n) { console.log("already anchored on chain"); process.exit(0); }
  const hash = await wallet.writeContract({ address: d.contract, abi: art.abi, functionName: "anchor", args: [dealKey, `0x${r.finalHash}`, `0x${r.referee.hash}`] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  r.anchor = { status: "anchored", chain: "Kite AI testnet", chainId: 2368, contract: d.contract, txHash: hash, explorerUrl: `${EXPLORER}/tx/${hash}`, finalHash: r.finalHash, block: Number(rc.blockNumber) };
  writeFileSync(file, JSON.stringify(r, null, 2));
  console.log("anchored", r.dealId, r.anchor.explorerUrl, "status", rc.status);
} else {
  console.log("usage: deploy | anchor <receipt.json>");
}
