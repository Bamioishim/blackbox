import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WORKER_PATH = "/api/settlement/worker";

/** Reject cross-origin API mutations. The settlement worker uses bearer auth. */
export function proxy(request: NextRequest) {
  if (!MUTATING_METHODS.has(request.method) || request.nextUrl.pathname === WORKER_PATH) {
    return NextResponse.next();
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.toLowerCase();
  if (!origin || !host) {
    console.warn("[security] cross_origin_mutation_rejected", { method: request.method, path: request.nextUrl.pathname });
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }
  try {
    const parsed = new URL(origin);
    const localHttp = parsed.protocol === "http:" && (host === "localhost:3000" || host === "127.0.0.1:3000");
    if (parsed.host.toLowerCase() !== host || (parsed.protocol !== "https:" && !localHttp)) {
      console.warn("[security] cross_origin_mutation_rejected", { method: request.method, path: request.nextUrl.pathname });
      return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
    }
  } catch {
    console.warn("[security] invalid_origin_rejected", { method: request.method, path: request.nextUrl.pathname });
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
