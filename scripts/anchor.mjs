// Optional Kite testnet path (not used in production).
// Live anchoring is scripts/anchor-solana.mjs + src/lib/anchor-solana.ts (SPL Memo on Solana mainnet).
// This script deploys BlackboxAnchor to Kite AI testnet (once) and can anchor recorded deals.
//   npm run anchor:kite -- check
//   npm run anchor:kite -- deploy
//   npm run anchor:kite -- anchor public/deals/deal_xxx.json
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
const art = JSON.parse(readFileSync("contracts/BlackboxAnchor.json", "utf8"));
const pub = createPublicClient({ chain: kite, transport: http(process.env.KITE_TESTNET_RPC_URL) });
const DEPLOY_FILE = "contracts/deployment.kite-testnet.json";

function usage() {
  console.log("usage: npm run anchor:kite -- check | deploy | anchor <receipt.json>");
}

function loadDeployer() {
  if (!existsSync(keyFile)) {
    throw new Error(`Missing deployer key file: ${keyFile}. Set ANCHOR_KEY_FILE to a protected file outside the repository.`);
  }
  try {
    const raw = readFileSync(keyFile, "utf8").trim();
    const key = (raw.startsWith("0x") ? raw : `0x${raw}`);
    return privateKeyToAccount(key);
  } catch {
    throw new Error(`Invalid EVM private key in ${keyFile}. The key value was not displayed.`);
  }
}

async function assertNetwork() {
  const chainId = await pub.getChainId();
  if (chainId !== kite.id) throw new Error(`Wrong RPC network: expected chain ${kite.id}, got ${chainId}.`);
}

function readDeployment() {
  if (!existsSync(DEPLOY_FILE)) return null;
  const deployment = JSON.parse(readFileSync(DEPLOY_FILE, "utf8"));
  if (deployment.chainId !== kite.id || !/^0x[0-9a-fA-F]{40}$/.test(deployment.contract ?? "")) {
    throw new Error(`${DEPLOY_FILE} is not a valid Kite testnet deployment record.`);
  }
  return deployment;
}

async function assertDeployedCode(deployment) {
  const code = await pub.getBytecode({ address: deployment.contract });
  if (!code || code === "0x") throw new Error(`No contract code at ${deployment.contract} on Kite testnet.`);
}

async function estimateDeployment(account) {
  const estimate = await pub.estimateContractGas({ abi: art.abi, bytecode: art.bytecode, account });
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const required = gasLimit * await pub.getGasPrice();
  return { gasLimit, required };
}

function asBytes32(value, label) {
  if (typeof value !== "string") throw new Error(`Receipt is missing ${label}.`);
  const hex = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`Receipt ${label} must be 32-byte hex.`);
  return hex;
}

async function check(account) {
  await assertNetwork();
  const balance = await pub.getBalance({ address: account.address });
  console.log("network: KiteAI Testnet (chain 2368)");
  console.log("deployer:", account.address);
  console.log("balance:", formatEther(balance), "KITE");

  const deployment = readDeployment();
  if (!deployment) {
    console.log("contract: not deployed (no deployment record)");
    const { gasLimit, required } = await estimateDeployment(account);
    console.log("estimated gas limit (20% buffer):", gasLimit.toString());
    console.log("estimated maximum fee:", formatEther(required), "KITE");
    console.log("readiness:", balance >= required ? "balance covers estimate" : "more test KITE needed");
    if (balance < required) process.exitCode = 1;
    return;
  }
  await assertDeployedCode(deployment);
  console.log("contract:", deployment.contract);
  console.log("deploy transaction:", `${EXPLORER}/tx/${deployment.deployTx}`);
  console.log("status: deployment record matches live contract code");
}

async function deploy(account) {
  await assertNetwork();
  const existing = readDeployment();
  if (existing) {
    await assertDeployedCode(existing);
    console.log("already deployed:", existing.contract, `${EXPLORER}/tx/${existing.deployTx}`);
    return;
  }

  const balance = await pub.getBalance({ address: account.address });
  const { gasLimit, required } = await estimateDeployment(account);
  console.log("estimated gas limit (20% buffer):", gasLimit.toString());
  console.log("estimated maximum fee:", formatEther(required), "KITE");
  console.log("deployer balance:", formatEther(balance), "KITE");
  if (balance < required) {
    throw new Error(`Insufficient testnet KITE for estimated deployment fee; fund ${account.address} and rerun.`);
  }

  const wallet = createWalletClient({ account, chain: kite, transport: http(process.env.KITE_TESTNET_RPC_URL) });
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, gas: gasLimit });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Deployment transaction failed: ${EXPLORER}/tx/${hash}`);
  }
  const code = await pub.getBytecode({ address: receipt.contractAddress });
  if (!code || code === "0x") throw new Error(`Deployment receipt succeeded but no code is present at ${receipt.contractAddress}.`);

  const deployment = {
    chain: "Kite AI testnet",
    chainId: kite.id,
    contract: receipt.contractAddress,
    deployTx: hash,
    deployer: account.address,
    block: Number(receipt.blockNumber),
    explorer: `${EXPLORER}/address/${receipt.contractAddress}`,
  };
  writeFileSync(DEPLOY_FILE, JSON.stringify(deployment, null, 2) + "\n", { flag: "wx" });
  console.log("deployed:", deployment.contract, `${EXPLORER}/tx/${hash}`);
}

async function anchor(account, file) {
  if (!file) throw new Error("Provide a receipt path: anchor <receipt.json>.");
  if (!existsSync(file)) throw new Error(`Receipt file not found: ${file}.`);
  await assertNetwork();
  const deployment = readDeployment();
  if (!deployment) throw new Error(`No deployment record at ${DEPLOY_FILE}; deploy BlackboxAnchor first.`);
  await assertDeployedCode(deployment);

  const receipt = JSON.parse(readFileSync(file, "utf8"));
  if (typeof receipt.dealId !== "string" || !receipt.dealId.trim()) throw new Error("Receipt is missing dealId.");
  const dealKey = keccak256(toBytes(receipt.dealId));
  const finalHash = asBytes32(receipt.finalHash, "finalHash");
  const refereeHash = asBytes32(receipt.referee?.hash, "referee.hash");
  const existing = await pub.readContract({ address: deployment.contract, abi: art.abi, functionName: "anchors", args: [dealKey] });
  if (existing[2] !== 0n) {
    if (String(existing[0]).toLowerCase() === finalHash.toLowerCase() && String(existing[1]).toLowerCase() === refereeHash.toLowerCase()) {
      console.log("already anchored with matching hashes on chain");
      return;
    }
    throw new Error("This deal ID is already anchored with different hashes; refusing to overwrite or misreport it.");
  }

  const wallet = createWalletClient({ account, chain: kite, transport: http(process.env.KITE_TESTNET_RPC_URL) });
  const hash = await wallet.writeContract({ address: deployment.contract, abi: art.abi, functionName: "anchor", args: [dealKey, finalHash, refereeHash] });
  const txReceipt = await pub.waitForTransactionReceipt({ hash });
  if (txReceipt.status !== "success") throw new Error(`Anchor transaction failed: ${EXPLORER}/tx/${hash}`);

  receipt.anchor = {
    status: "anchored",
    chain: "Kite AI testnet",
    chainId: kite.id,
    contract: deployment.contract,
    txHash: hash,
    explorerUrl: `${EXPLORER}/tx/${hash}`,
    finalHash: receipt.finalHash,
    block: Number(txReceipt.blockNumber),
  };
  writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
  console.log("anchored:", receipt.dealId, receipt.anchor.explorerUrl, "status", txReceipt.status);
}

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h" || !["check", "deploy", "anchor"].includes(cmd)) {
    usage();
    if (cmd && !["--help", "-h"].includes(cmd)) process.exitCode = 2;
    return;
  }
  const account = loadDeployer();
  if (cmd === "check") return check(account);
  if (cmd === "deploy") return deploy(account);
  return anchor(account, file);
}

main().catch((error) => {
  console.error("Kite testnet anchor operation failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
