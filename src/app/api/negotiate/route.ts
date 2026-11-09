import { negotiate, type NegotiateInput, type StreamEvent } from "@/lib/negotiate";
import type { Style } from "@/lib/agents";

export const maxDuration = 300;

const STYLES: Style[] = ["patient", "balanced", "eager"];
let inFlight = 0;
const recent: number[] = [];

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e4) / 1e4 : null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "bad request" }, { status: 400 });
  const input: NegotiateInput = {
    item: String(body.item ?? "X tokens").replace(/[^\w\s$.\-]/g, "").slice(0, 40) || "X tokens",
    quantity: Math.round(num(body.quantity, 1, 1_000_000) ?? 500),
    referencePrice: num(body.referencePrice, 0.0001, 1_000_000) ?? 0.9,
    buyerCeiling: num(body.buyerCeiling, 0.0001, 1_000_000) ?? 0.92,
    sellerFloor: num(body.sellerFloor, 0.0001, 1_000_000) ?? 0.88,
    buyerStyle: STYLES.includes(body.buyerStyle as Style) ? (body.buyerStyle as Style) : "balanced",
    sellerStyle: STYLES.includes(body.sellerStyle as Style) ? (body.sellerStyle as Style) : "balanced",
    maxRounds: Math.round(num(body.maxRounds, 2, 10) ?? 6),
    attackMode: Boolean(body.attackMode),
    budget: num(body.budget, 0.01, 1_000_000_000) ?? undefined,
  };
  // Small guard so a public preview can't burn the SERV credits.
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (inFlight >= 3 || recent.length >= 8) return Response.json({ error: "Busy. Try again in a minute." }, { status: 429 });
  recent.push(now);
  inFlight++;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await negotiate(input, emit);
      } catch (e) {
        emit({ t: "error", message: (e as Error).message });
      } finally {
        inFlight--;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
