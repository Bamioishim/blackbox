import { db } from "@/lib/db";
import { setSession, verifyPassword } from "@/lib/session";

export async function POST(req: Request) {
  const body = await req.json().catch(()=>null) as Record<string,unknown>|null;
  const email = String(body?.email??"").trim().toLowerCase();
  const password = String(body?.password??"");
  const sql = db();
  const rows = await sql`SELECT id,email,display_name,password_hash FROM bb_users WHERE email=${email} LIMIT 1`;
  const user = rows[0] as {id:string;email:string;display_name:string|null;password_hash:string|null}|undefined;
  if (!user?.password_hash || !verifyPassword(password,user.password_hash)) return Response.json({error:"Email or password is incorrect."},{status:401});
  await setSession(user.id);
  return Response.json({user:{id:user.id,email:user.email,display_name:user.display_name}});
}
