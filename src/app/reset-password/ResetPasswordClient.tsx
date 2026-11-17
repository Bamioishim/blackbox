"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ResetPasswordClient({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "This reset link is invalid or expired.");
      setMessage(data.message || "Password updated.");
      setPassword(""); setConfirm("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ maxWidth: 520, margin: "72px auto", padding: 24 }}>
    <p style={{ color: "var(--wax)", letterSpacing: ".14em", textTransform: "uppercase", fontSize: 12 }}>Account recovery</p>
    <h1 style={{ fontSize: 42, margin: "12px 0" }}>Set a new password</h1>
    {!token ? <p role="alert" style={{ color: "#e98b7e" }}>This reset link is missing its token. Request a new one.</p> : <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 28 }}>
      <label>New password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} style={{ display: "block", width: "100%", padding: 12, marginTop: 6 }} /></label>
      <label>Confirm password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} style={{ display: "block", width: "100%", padding: 12, marginTop: 6 }} /></label>
      <button disabled={busy} style={{ padding: 12, cursor: "pointer" }}>{busy ? "Updating…" : "Update password"}</button>
    </form>}
    {message && <p role="status" style={{ color: "var(--wax)", marginTop: 18 }}>{message}</p>}
    {error && <p role="alert" style={{ color: "#e98b7e", marginTop: 18 }}>{error}</p>}
    <p style={{ marginTop: 24 }}><Link href="/marketplace">Back to sign in</Link></p>
  </main>;
}
