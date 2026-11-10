import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword, setSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = await req.json().catch(()=>null) as Record<string,unknown>|null;
  const email = String(body?.email??"").trim().toLowerCase();
  const password = String(body?.password??"");
  const displayName = String(body?.displayName??"").trim().slice(0,60);
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return Response.json({error:"Enter a valid email and a password with at least 10 characters."},{status:400});
  try {
    const sql = db();
    const id = randomUUID();
    const rows = await sql`INSERT INTO bb_users (id,email,display_name,password_hash) VALUES (${id},${email},${displayName||email.split("@")[0]},${hashPassword(password)}) RETURNING id,email,display_name`;
    await setSession(id);
    return Response.json({user:rows[0]});
  } catch {
    return Response.json({error:"That email is already registered, or the account could not be created."},{status:409});
  }
}
