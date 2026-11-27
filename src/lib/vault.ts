import "server-only";
import { createClient, type OneclawClient } from "@1claw/sdk";

/**
 * Just-in-time secrets from 1Claw.
 *
 * Blackbox's agents never hold their keys at rest. When a step needs one (a SERV Reasoning call, a Kite agent
 * signing an offer, the anchor wallet writing a memo), the server asks 1Claw for that one path, keeps the value in
 * this process's memory only, and records the access (path, time, outcome; never the value) in the access log.
 *
 * Free-plan budget: every 1Claw request counts. One token exchange per process plus one GET per secret per process,
 * and a monthly cap (ONECLAW_MONTHLY_CAP, default 30) so a busy day can't drain the shared quota.
 */

export const VAULT_PATHS = {
  serv: "blackbox/serv-api-key",
  buyer: "blackbox/kite-buyer-agent-key",
  seller: "blackbox/kite-seller-agent-key",
  anchor: "blackbox/anchor-solana-key",
} as const;
export type SecretName = keyof typeof VAULT_PATHS;

/** The env var each secret used to live in. Only read when 1Claw is not configured (local dev, tests). */
const LEGACY_ENV: Record<SecretName, string> = {
  serv: "SERV_API_KEY",
  buyer: "BLACKBOX_BUYER_AGENT_KEY",
  seller: "BLACKBOX_SELLER_AGENT_KEY",
  anchor: "ANCHOR_SOLANA_SECRET_KEY",
};

const PURPOSE: Record<SecretName, string> = {
  serv: "SERV Reasoning call",
  buyer: "buyer agent signs its offers",
  seller: "seller agent signs its offers",
  anchor: "anchor wallet writes the deal hash",
};

export type AccessEntry = {
  at: string;
  path: string;
  purpose: string;
  /** fetched: a live 1Claw GET. memory: served from this process's cache, no 1Claw call. */
  source: "1claw" | "memory" | "denied" | "error";
  status?: number;
  note?: string;
};

type G = { __bbVault?: { cache: Map<SecretName, string>; inflight: Map<SecretName, Promise<string | null>>; failed: Map<SecretName, { at: number; message: string }>; log: AccessEntry[]; calls: number; lastMemoLog: Map<SecretName, number>; client?: OneclawClient } };
function state() {
  const g = globalThis as unknown as G;
  g.__bbVault ??= { cache: new Map(), inflight: new Map(), failed: new Map(), log: [], calls: 0, lastMemoLog: new Map() };
  return g.__bbVault;
}

/**
 * Which secrets this deployment takes from 1Claw. Default: all of them.
 * ONECLAW_SECRETS=serv limits it, e.g. when the only 1Claw agent on the plan has Intents enabled: 1Claw then
 * blocks raw reads of private_key secrets (403) so keys can only be used through its signing proxy.
 */
export function vaultManaged(name: SecretName): boolean {
  if (!oneclawConfigured()) return false;
  const list = process.env.ONECLAW_SECRETS?.trim();
  if (!list) return true;
  return list.split(",").map((x) => x.trim()).includes(name);
}

export function oneclawConfigured(): boolean {
  const e = process.env;
  return Boolean(e.ONECLAW_VAULT_ID?.trim() && e.ONECLAW_AGENT_ID?.trim() && e.ONECLAW_AGENT_API_KEY?.trim());
}

function client(): OneclawClient {
  const s = state();
  s.client ??= createClient({
    baseUrl: process.env.ONECLAW_BASE_URL?.trim() || "https://api.1claw.co",
    apiKey: process.env.ONECLAW_AGENT_API_KEY!.trim(),
    agentId: process.env.ONECLAW_AGENT_ID!.trim(),
  });
  return s.client;
}

function monthlyCap(): number {
  const n = Number(process.env.ONECLAW_MONTHLY_CAP ?? 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

async function persist(entry: AccessEntry, calls: number) {
  const s = state();
  s.log.unshift(entry);
  s.log.length = Math.min(s.log.length, 50);
  if (!process.env.DATABASE_URL) return;
  try {
    const { db } = await import("./db");
    const sql = db();
    await ensureTable();
    await sql`INSERT INTO bb_vault_access (path, purpose, source, status, note, oneclaw_calls) VALUES (${entry.path}, ${entry.purpose}, ${entry.source}, ${entry.status ?? null}, ${entry.note ?? null}, ${calls})`;
  } catch {
    /* the access log must never break a deal */
  }
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    const { db } = await import("./db");
    const sql = db();
    await sql`CREATE TABLE IF NOT EXISTS bb_vault_access (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), path text NOT NULL, purpose text NOT NULL, source text NOT NULL, status int, note text, oneclaw_calls int NOT NULL DEFAULT 0)`;
  })().catch((e) => { tableReady = null; throw e; });
  return tableReady;
}

/** 1Claw requests Blackbox has made this calendar month (UTC), across all instances. */
export async function callsThisMonth(): Promise<number> {
  const s = state();
  if (!process.env.DATABASE_URL) return s.calls;
  try {
    const { db } = await import("./db");
    await ensureTable();
    const rows = await db()`SELECT COALESCE(SUM(oneclaw_calls),0)::int AS n FROM bb_vault_access WHERE at >= date_trunc('month', now() AT TIME ZONE 'UTC')`;
    return Math.max(Number(rows[0]?.n ?? 0), s.calls);
  } catch {
    return s.calls;
  }
}

async function fetchFromVault(name: SecretName): Promise<string | null> {
  const s = state();
  const path = VAULT_PATHS[name];
  const purpose = PURPOSE[name];
  const used = await callsThisMonth();
  // A fresh process also pays one token exchange.
  const cost = s.client ? 1 : 2;
  if (used + cost > monthlyCap()) {
    await persist({ at: new Date().toISOString(), path, purpose, source: "denied", note: `monthly 1Claw budget (${monthlyCap()} calls) reached` }, 0);
    throw new Error(`1Claw budget for this month is used up (${monthlyCap()} calls). The key stays in the vault; nothing was fetched.`);
  }
  const c = client();
  const { data, error, meta } = await c.secrets.get(process.env.ONECLAW_VAULT_ID!.trim(), path);
  s.calls += cost;
  if (error || !data?.value) {
    await persist({ at: new Date().toISOString(), path, purpose, source: "error", status: meta?.status, note: error?.type ?? "no value" }, cost);
    throw new Error(`1Claw refused ${path} (${meta?.status ?? "?"} ${error?.type ?? "no value"}).`);
  }
  await persist({ at: new Date().toISOString(), path, purpose, source: "1claw", status: meta?.status ?? 200 }, cost);
  return data.value;
}

/**
 * Get one secret at call time. 1Claw first (cached per process); the legacy env var only when 1Claw
 * isn't configured, so local dev and tests keep working. Returns null if the secret isn't set anywhere.
 */
export async function getSecret(name: SecretName): Promise<string | null> {
  if (!vaultManaged(name)) return process.env[LEGACY_ENV[name]]?.trim() || null;
  const s = state();
  // A refusal is remembered for 10 minutes so a misconfigured path can't burn the monthly quota deal after deal.
  const failed = s.failed.get(name);
  if (failed && Date.now() - failed.at < 10 * 60_000) throw new Error(failed.message);
  const hit = s.cache.get(name);
  if (hit) {
    const last = s.lastMemoLog.get(name) ?? 0;
    if (Date.now() - last > 60_000) {
      s.lastMemoLog.set(name, Date.now());
      void persist({ at: new Date().toISOString(), path: VAULT_PATHS[name], purpose: PURPOSE[name], source: "memory", note: "served from process memory, no 1Claw call" }, 0);
    }
    return hit;
  }
  let p = s.inflight.get(name);
  if (!p) {
    p = fetchFromVault(name)
      .catch((e: Error) => { s.failed.set(name, { at: Date.now(), message: e.message }); throw e; })
      .finally(() => s.inflight.delete(name));
    s.inflight.set(name, p);
  }
  const v = await p;
  if (v) {
    s.cache.set(name, v);
    s.lastMemoLog.set(name, Date.now());
  }
  return v;
}

/** True when the secret can be obtained (vault configured, or legacy env present). No 1Claw call. */
export function secretAvailable(name: SecretName): boolean {
  return vaultManaged(name) || Boolean(process.env[LEGACY_ENV[name]]?.trim());
}

/** Public, value-free access log for the "Secured by 1Claw" panel. */
export async function accessLog(limit = 12): Promise<{ entries: AccessEntry[]; callsThisMonth: number; cap: number; configured: boolean; fromVault: string[]; notFromVault: string[] }> {
  const s = state();
  const configured = oneclawConfigured();
  let entries = s.log.slice(0, limit);
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import("./db");
      await ensureTable();
      const rows = await db()`SELECT at, path, purpose, source, status, note FROM bb_vault_access ORDER BY id DESC LIMIT ${limit}`;
      entries = rows.map((r) => ({ at: new Date(r.at as string).toISOString(), path: String(r.path), purpose: String(r.purpose), source: r.source as AccessEntry["source"], status: r.status == null ? undefined : Number(r.status), note: r.note == null ? undefined : String(r.note) }));
    } catch { /* fall back to this process's log */ }
  }
  const names = Object.keys(VAULT_PATHS) as SecretName[];
  return {
    entries, callsThisMonth: await callsThisMonth(), cap: monthlyCap(), configured,
    fromVault: names.filter((n) => vaultManaged(n)).map((n) => VAULT_PATHS[n]),
    notFromVault: names.filter((n) => !vaultManaged(n)).map((n) => VAULT_PATHS[n]),
  };
}

/** Test hook. */
export function _resetVaultForTests() {
  (globalThis as unknown as G).__bbVault = undefined;
}
