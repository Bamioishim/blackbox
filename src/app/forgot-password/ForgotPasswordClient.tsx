"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not request a reset link.");
      setMessage(data.message || "If the account exists, a reset link will be sent.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ maxWidth: 520, margin: "72px auto", padding: 24 }}>
    <p style={{ color: "var(--wax)", letterSpacing: ".14em", textTransform: "uppercase", fontSize: 12 }}>Account recovery</p>
    <h1 style={{ fontSize: 42, margin: "12px 0" }}>Forgot your password?</h1>
    <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>Enter the email on your Blackbox account. If it exists, we will send a one-time reset link that expires after 30 minutes.</p>
    <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 28 }}>
      <label>Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} style={{ display: "block", width: "100%", padding: 12, marginTop: 6 }} /></label>
      <button disabled={busy} style={{ padding: 12, cursor: "pointer" }}>{busy ? "Sending…" : "Send reset link"}</button>
    </form>
    {message && <p role="status" style={{ color: "var(--wax)", marginTop: 18 }}>{message}</p>}
    {error && <p role="alert" style={{ color: "#e98b7e", marginTop: 18 }}>{error}</p>}
    <p style={{ marginTop: 24 }}><Link href="/marketplace">Back to Blackbox</Link></p>
  </main>;
}
