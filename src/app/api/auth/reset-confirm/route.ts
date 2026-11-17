import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/session";
import { ensureAuthSecuritySchema, rateLimit, rateLimited } from "@/lib/security";

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 4096) return Response.json({ error: "Request too large." }, { status: 413 });
  const limit = await rateLimit(req, "password-reset-confirm", 5, 900);
  if (!limit.allowed) return rateLimited(limit.retryAfter);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || password.length < 12 || password.length > 256) {
    return Response.json({ error: "This reset link is invalid or expired, or the new password does not meet the requirements." }, { status: 400 });
  }
  await ensureAuthSecuritySchema();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const passwordHash = hashPassword(password);
  const rows = await db()`WITH consumed AS (
    UPDATE bb_password_resets SET used_at=now()
    WHERE token_hash=${tokenHash} AND used_at IS NULL AND expires_at>now()
    RETURNING user_id
  )
  UPDATE bb_users SET password_hash=${passwordHash},session_version=session_version+1
  WHERE id IN (SELECT user_id FROM consumed)
  RETURNING id`;
  if (!rows.length) return Response.json({ error: "This reset link is invalid or expired, or has already been used." }, { status: 400 });
  return Response.json({ ok: true, message: "Password updated. Sign in with your new password." }, { headers: { "Cache-Control": "no-store" } });
}
