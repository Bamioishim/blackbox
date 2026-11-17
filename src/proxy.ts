import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "blackbox_session";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Same-origin guard for cookie-authenticated mutations. Server-to-server
 * worker calls do not carry the browser session cookie and are unaffected.
 */
export function proxy(request: NextRequest) {
  if (!MUTATING_METHODS.has(request.method) || !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.toLowerCase();
  if (!origin || !host) {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }

  try {
    const parsed = new URL(origin);
    if (parsed.host.toLowerCase() !== host || parsed.protocol !== "https:" && host !== "localhost:3000") {
      return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
