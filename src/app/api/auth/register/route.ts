import { createHmac, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword, setSession } from "@/lib/session";
import { rateLimit, rateLimited } from "@/lib/security";

export async function POST(req: Request) {
  const ipLimit = await rateLimit(req, "register-ip", 5, 3600);
  if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfter);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 254);
  const password = String(body?.password ?? "");
  const displayName = String(body?.displayName ?? "").trim().slice(0, 60);
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || password.length > 256) {
    return Response.json({ error: "Enter a valid email and a password with at least 12 characters." }, { status: 400 });
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not configured.");
  const identity = createHmac("sha256", secret).update(email).digest("hex");
  const emailLimit = await rateLimit(req, "register-email", 3, 3600, identity);
  if (!emailLimit.allowed) return rateLimited(emailLimit.retryAfter);
  try {
    const id = randomUUID();
    const rows = await db()\`INSERT INTO bb_users(id,email,display_name,password_hash)
      VALUES(\${id},\${email},\${displayName || email.split("@")[0]},\${hashPassword(password)})
      RETURNING id,email,display_name\`;
    await setSession(id);
    return Response.json({ user: rows[0] }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "That email is already registered, or the account could not be created." }, { status: 409 });
  }
}
