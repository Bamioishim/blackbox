import { connection } from "next/server";
import { rateLimit, rateLimited } from "@/lib/security";
import { accessLog, VAULT_PATHS } from "@/lib/vault";

/** Value-free 1Claw access log for the "Secured by 1Claw" panel. Reads Blackbox's own DB, never 1Claw. */
export async function GET(req: Request) {
  await connection();
  const limit = await rateLimit(req, "vault-log-read", 60, 60);
  if (!limit.allowed) return rateLimited(limit.retryAfter);
  const log = await accessLog(12);
  return Response.json({ ...log, paths: Object.values(VAULT_PATHS) }, { headers: { "Cache-Control": "no-store" } });
}
