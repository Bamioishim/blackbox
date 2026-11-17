import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { ensureAuthSecuritySchema } from "./security";

const COOKIE = "blackbox_session";
const MAX_AGE = 60 * 60 * 24 * 14;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be configured with at least 32 random characters.");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(hash ?? "")) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function setSession(userId: string) {
  await ensureAuthSecuritySchema();
  const rows = await db()`SELECT session_version FROM bb_users WHERE id=${userId} LIMIT 1`;
  if (!rows.length) throw new Error("Cannot create a session for an unknown account.");
  const version = Number((rows[0] as { session_version: number }).session_version);
  const payload = Buffer.from(JSON.stringify({ sub: userId, ver: version, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, payload + "." + sign(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
}

export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; ver?: number; exp?: number };
    if (!data.sub || typeof data.ver !== "number" || typeof data.exp !== "number" || data.exp <= Math.floor(Date.now() / 1000)) return null;
    await ensureAuthSecuritySchema();
    const rows = await db()`SELECT id,email,display_name,session_version FROM bb_users WHERE id=${data.sub} LIMIT 1`;
    const user = rows[0] as { id: string; email: string; display_name: string | null; session_version: number } | undefined;
    if (!user || Number(user.session_version) !== data.ver) return null;
    return { id: user.id, email: user.email, display_name: user.display_name };
  } catch {
    return null;
  }
}
