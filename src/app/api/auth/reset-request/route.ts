import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ensureAuthSecuritySchema, rateLimit, rateLimited } from "@/lib/security";

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 4096) return Response.json({ message: "If the account exists, a reset link will be sent." }, { status: 200 });
  const ipLimit = await rateLimit(req, "password-reset-ip", 3, 3600);
  if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfter);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 254);
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ message: "If the account exists, a reset link will be sent." });
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not configured.");
  const emailKey = createHash("sha256").update(email).digest("hex");
  const emailLimit = await rateLimit(req, "password-reset-email", 3, 3600, emailKey);
  if (!emailLimit.allowed) return rateLimited(emailLimit.retryAfter);

  await ensureAuthSecuritySchema();
  const rows = await db()`SELECT id,email FROM bb_users WHERE email=${email} LIMIT 1`;
  const user = rows[0] as { id: string; email: string } | undefined;
  if (user) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db()`UPDATE bb_password_resets SET used_at=now() WHERE user_id=${user.id} AND used_at IS NULL`;
    await db()`INSERT INTO bb_password_resets(token_hash,user_id,expires_at) VALUES(${tokenHash},${user.id},now()+interval '30 minutes')`;
    const key = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (key && from) {
      const base = (process.env.NEXT_PUBLIC_APP_URL || "https://blackbox-serv.vercel.app").replace(/\/$/, "");
      const link = base + "/reset-password?token=" + encodeURIComponent(token);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to: user.email, subject: "Reset your Blackbox password",
          text: "Use this one-time link to reset your Blackbox password. It expires in 30 minutes: " + link,
        }),
      });
      if (!response.ok) {
        await db()`UPDATE bb_password_resets SET used_at=now() WHERE token_hash=${tokenHash}`;
        console.error("Password reset email delivery failed.");
      }
    } else {
      await db()`UPDATE bb_password_resets SET used_at=now() WHERE token_hash=${tokenHash}`;
      console.error("Password reset email is not configured.");
    }
  }
  return Response.json({ message: "If the account exists, a reset link will be sent." }, { headers: { "Cache-Control": "no-store" } });
}
