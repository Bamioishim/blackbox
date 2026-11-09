import "server-only";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Receipt } from "./receipt";

/** The recorded deal featured on the home page and in the stat bar (public/deals/index.json, hero: true). */
export function heroReceipt(): Receipt | null {
  const dir = path.join(process.cwd(), "public", "deals");
  const idx = path.join(dir, "index.json");
  if (!existsSync(idx)) return null;
  const list = JSON.parse(readFileSync(idx, "utf8")) as { id: string; hero?: boolean }[];
  const pick = list.find((d) => d.hero) ?? list[0];
  return pick ? JSON.parse(readFileSync(path.join(dir, `${pick.id}.json`), "utf8")) : null;
}
