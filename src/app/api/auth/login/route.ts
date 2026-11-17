import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { setSession, verifyPassword } from "@/lib/session";
import { rateLimit, rateLimited } from "@/lib/security";

export async function POST(req: Request) {
  const ipLimit = await rateLimit(req, "login-ip", 8, 15 * 60);
  if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfter);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 254);
  const password = String(body?.password ?? "");
  if (!/^\\S+@\\S+\\.\\S+$/.test(email) || !password || password.length > 256) {
    return Response.json({ error: "Email or password is incorrect." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not configured.");
  const identity = createHmac("sha256", secret).update(email).digest("hex");
  const emailLimit = await rateLimit(req, "login-email", 8, 15 * 60, identity);
  if (!emailLimit.allowed) return rateLimited(emailLimit.retryAfter);

  const rows = await db()`SELECT id,email,display_name,password_hash FROM bb_users WHERE email=${email} LIMIT 1`;
  const user = rows[0] as { id: string; email: string; display_name: string | null; password_hash: string | null } | undefined;
  if (!user?.password_hash || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Email or password is incorrect." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await setSession(user.id);
  return Response.json({ user: { id: user.id, email: user.email, display_name: user.display_name } }, { headers: { "Cache-Control": "no-store" } });
}
