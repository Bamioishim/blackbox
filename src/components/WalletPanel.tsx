"use client";
import { useState } from "react";
import { formatUnits, isAddress, stringToHex } from "viem";
import { base } from "viem/chains";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } } }

type Portfolio = {
  chain: string; address: string; native: { name: string; symbol: string; balance: string };
  tokens: any[]; nfts: any[]; source: string;
};
const field: React.CSSProperties = { width: "100%", padding: 10, background: "#111", border: "1px solid var(--rule-2)", color: "var(--ink)", borderRadius: 6 };
const action: React.CSSProperties = { border: "1px solid var(--wax)", background: "var(--wax)", color: "#111", borderRadius: 6, padding: "10px 14px", cursor: "pointer", fontWeight: 600 };

export function WalletPanel({ onAdded }: { onAdded?: () => void }) {
  const [address, setAddress] = useState("");
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [secret, setSecret] = useState("");
  const [importMode, setImportMode] = useState<"private-key" | "seed">("private-key");
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(addr: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await fetch("/api/wallet/portfolio?address=" + encodeURIComponent(addr), { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not load portfolio.");
      setAddress(addr); setPortfolio(data); setMessage("Base wallet loaded.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function connect() {
    setError("");
    try {
      if (!window.ethereum) throw new Error("No EVM wallet detected. Open Blackbox in your wallet browser or import a wallet.");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0] || !isAddress(accounts[0])) throw new Error("Wallet did not return a valid address.");
      const chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;
      if (Number(chainId) !== base.id) {
        try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }); }
        catch { throw new Error("Switch your wallet to Base to view this portfolio."); }
      }
      setSecret("");
      await load(accounts[0]);
    } catch (e) { setError((e as Error).message); }
  }

  async function importWallet() {
    setError("");
    try {
      const account = importMode === "seed"
        ? mnemonicToAccount(secret.trim())
        : privateKeyToAccount((secret.trim().startsWith("0x") ? secret.trim() : "0x" + secret.trim()) as `0x${string}`);
      await load(account.address);
    } catch (e) { setError("That private key or recovery phrase is not valid."); }
  }

  async function addAsset(type: "token" | "nft", item: any) {
    if (!portfolio) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const contractAddress = type === "token"
        ? String(item.token?.address_hash || "")
        : String(item.token?.address_hash || item.token_address_hash || item.token?.address || "");
      const tokenId = type === "nft" ? String(item.id || item.token_id || "") : "";
      const standard = type === "token" ? "ERC-20" : String(item.token_type || "ERC-721");
      const quantity = type === "token" ? tokenValue(item) : "1";
      if (!isAddress(contractAddress)) throw new Error("This asset is missing a valid contract address.");
      const timestamp = Date.now();
      const message = [
        "Blackbox wallet asset import",
        "user:pending",
        "chain:8453",
        `wallet:${address.toLowerCase()}`,
        `type:${type}`,
        `contract:${contractAddress.toLowerCase()}`,
        `tokenId:${tokenId}`,
        `quantity:${quantity}`,
        `timestamp:${timestamp}`
      ].join("\\n");
      let signature: string;
      if (secret) {
        const account = importMode === "seed"
          ? mnemonicToAccount(secret.trim())
          : privateKeyToAccount((secret.trim().startsWith("0x") ? secret.trim() : "0x" + secret.trim()) as `0x${string}`);
        // The server binds the signature to the signed-in Blackbox account. Fetch the challenge first.
        const challengeRes = await fetch("/api/portfolio/wallet/challenge");
        const challenge = await challengeRes.json();
        if (!challengeRes.ok) throw new Error(challenge.error || "Sign in to add wallet assets.");
        const signedMessage = message.replace("user:pending", `user:${challenge.userId}`);
        signature = await account.signMessage({ message: signedMessage });
        const result = await fetch("/api/portfolio/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, contractAddress, assetType: type, tokenId, quantity, timestamp, signature, standard, name: item.name || item.token?.name, symbol: item.symbol || item.token?.symbol }) });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || "Could not add this asset.");
      } else {
        if (!window.ethereum) throw new Error("Reconnect the wallet to sign the ownership proof.");
        const challengeRes = await fetch("/api/portfolio/wallet/challenge");
        const challenge = await challengeRes.json();
        if (!challengeRes.ok) throw new Error(challenge.error || "Sign in to add wallet assets.");
        const signedMessage = message.replace("user:pending", `user:${challenge.userId}`);
        signature = String(await window.ethereum.request({ method: "personal_sign", params: [stringToHex(signedMessage), address] }));
        const result = await fetch("/api/portfolio/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, contractAddress, assetType: type, tokenId, quantity, timestamp, signature, standard, name: item.name || item.token?.name, symbol: item.symbol || item.token?.symbol }) });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || "Could not add this asset.");
      }
      setMessage("Ownership verified and asset added to your portfolio.");
      onAdded?.();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function exportSecret() {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); setMessage("Recovery material copied. Keep it offline and private."); }
    catch { setError("Clipboard access was blocked. Use your wallet's own export flow."); }
  }

  function disconnect() {
    setAddress(""); setPortfolio(null); setSecret(""); setError(""); setMessage("");
  }

  const tokenName = (item: any) => item.token?.name || item.token?.symbol || "Token";
  const tokenSymbol = (item: any) => item.token?.symbol || "";
  const tokenValue = (item: any) => {
    const decimals = Number(item.token?.decimals ?? 18);
    try { return formatUnits(BigInt(item.value || "0"), decimals); } catch { return "0"; }
  };

  return <section className="wallet-panel">
    <div className="wallet-head"><div><span className="hud">WALLET</span><h3 className="display" style={{ fontSize: 22, margin: "4px 0 0" }}>Connect a wallet</h3></div>
      {address ? <button type="button" onClick={disconnect} className="wallet-quiet">Disconnect</button> : <button type="button" style={action} onClick={connect} disabled={busy}>{busy ? "Loading…" : "Connect wallet"}</button>}
    </div>
    {!address && <div className="wallet-import">
      <button type="button" className="wallet-quiet" onClick={() => setShowImport(v => !v)}>{showImport ? "Close import" : "Import private key or seed phrase"}</button>
      {showImport && <div className="wallet-import-form">
        <select style={field} value={importMode} onChange={e => setImportMode(e.target.value as "private-key" | "seed")}><option value="private-key">Private key</option><option value="seed">Recovery phrase</option></select>
        <textarea style={field} rows={2} autoComplete="off" spellCheck={false} value={secret} onChange={e => setSecret(e.target.value)} placeholder={importMode === "seed" ? "Enter recovery phrase" : "0x…"} />
        <button type="button" style={action} onClick={importWallet} disabled={busy || !secret.trim()}>{busy ? "Loading…" : "Import locally"}</button>
        <p className="wallet-warning">Your key or phrase stays in this browser session and is never sent to Blackbox. Imported keys are cleared when you disconnect or reload. Never enter a wallet secret on a site you do not trust.</p>
      </div>}
    </div>}
    {address && <div className="wallet-address"><span>{address.slice(0, 8)}…{address.slice(-6)}</span><span>BASE · 8453</span></div>}
    {message && <p className="wallet-message">{message}</p>}
    {error && <p className="wallet-error">{error}</p>}
    {portfolio && <div className="wallet-holdings">
      <div className="wallet-balance"><span>Native balance</span><b>{Number(formatUnits(BigInt(portfolio.native.balance || "0"), 18)).toFixed(5)} ETH</b></div>
      <div className="wallet-subhead">TOKENS <span>{portfolio.tokens.length}</span></div>
      {portfolio.tokens.length ? portfolio.tokens.map((item, i) => <div className="wallet-row" key={item.token?.address_hash || i}><span><b>{tokenName(item)}</b><small>{tokenSymbol(item)}</small></span><strong>{Number(tokenValue(item)).toLocaleString(undefined,{maximumFractionDigits:6})}</strong><button type="button" className="wallet-add" disabled={busy} onClick={() => addAsset("token",item)}>Add</button></div>) : <p className="wallet-empty">No token balances found.</p>}
      <div className="wallet-subhead">NFTS <span>{portfolio.nfts.length}</span></div>
      {portfolio.nfts.length ? portfolio.nfts.slice(0, 12).map((item, i) => <div className="wallet-row" key={item.id || i}><span><b>{item.name || item.token?.name || "NFT"}</b><small>#{item.id || item.token_id || "—"}</small></span><strong>{item.token_type || "NFT"}</strong><button type="button" className="wallet-add" disabled={busy} onClick={() => addAsset("nft",item)}>Add</button></div>) : <p className="wallet-empty">No NFTs found on Base.</p>}
      <p className="wallet-source">Portfolio data from {portfolio.source}. Read-only. Assets have not been escrowed or transferred.</p>
      {secret && <button type="button" className="wallet-quiet" onClick={exportSecret}>Copy imported recovery material</button>}
    </div>}
  </section>;
}
