import "server-only";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";

let tableReady: Promise<void> | null = null;
let authSchemaReady: Promise<void> | null = null;

function rateKey(scope: string, ip: string, identity = "") {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return createHmac("sha256", secret).update([scope, ip, identity].join(":")).digest("hex");
}

export async function ensureAuthSecuritySchema() {
  if (!authSchemaReady) {
    authSchemaReady = (async () => {
      const sql = db();
      await sql`ALTER TABLE bb_users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0`;
      await sql`CREATE TABLE IF NOT EXISTS bb_password_resets (
        token_hash text PRIMARY KEY,
        user_id text NOT NULL REFERENCES bb_users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS bb_password_resets_user_idx ON bb_password_resets(user_id)`;
    })().catch((error) => { authSchemaReady = null; throw error; });
  }
  return authSchemaReady;
}

async function ensureRateLimitTable() {
  if (!tableReady) {
    tableReady = db()`CREATE TABLE IF NOT EXISTS bb_security_rate_limits (
      key_hash text PRIMARY KEY,
      hits integer NOT NULL DEFAULT 0,
      window_started_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.then(() => undefined).catch((error) => { tableReady = null; throw error; });
  }
  return tableReady;
}

/** Atomic, database-backed rate limit shared by all serverless instances. */
export async function rateLimit(req: Request, scope: string, maxHits: number, windowSeconds: number, identity = "") {
  await ensureRateLimitTable();
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip") || "unknown";
  const key = rateKey(scope, ip, identity);
  const rows = await db()`INSERT INTO bb_security_rate_limits(key_hash,hits,window_started_at)
    VALUES (${key},1,now())
    ON CONFLICT(key_hash) DO UPDATE SET
      hits = CASE WHEN bb_security_rate_limits.window_started_at <= now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE bb_security_rate_limits.hits + 1 END,
      window_started_at = CASE WHEN bb_security_rate_limits.window_started_at <= now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE bb_security_rate_limits.window_started_at END,
      updated_at = now()
    RETURNING hits,window_started_at`;
  const row = rows[0] as { hits: number; window_started_at: string };
  const retryAfter = Math.max(1, Math.ceil((new Date(row.window_started_at).getTime() + windowSeconds * 1000 - Date.now()) / 1000));
  return { allowed: Number(row.hits) <= maxHits, retryAfter };
}

export function rateLimited(retryAfter: number) {
  console.warn("[security] rate_limit_triggered", { retryAfter });
  return Response.json(
    { error: "Too many attempts. Please wait before trying again." },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}
