import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";

const COOKIE = "blackbox_session";
const MAX_AGE = 60 * 60 * 24 * 14;
function secret() {
  const value = process.env.SESSION_SECRET || process.env.DATABASE_URL;
  if (!value) throw new Error("Session signing secret is not configured.");
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
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function setSession(userId: string) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now()/1000)+MAX_AGE })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, payload + "." + sign(payload), { httpOnly:true, secure:process.env.NODE_ENV==="production", sameSite:"lax", path:"/", maxAge:MAX_AGE });
}
export async function clearSession() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly:true, secure:process.env.NODE_ENV==="production", sameSite:"lax", path:"/", maxAge:0 });
}
export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {sub:string;exp:number};
    if (!data.sub || data.exp < Math.floor(Date.now()/1000)) return null;
    const sql = db();
    const rows = await sql`SELECT id, email, display_name FROM bb_users WHERE id = ${data.sub} LIMIT 1`;
    return (rows[0] as {id:string;email:string;display_name:string|null}|undefined) ?? null;
  } catch { return null; }
}
