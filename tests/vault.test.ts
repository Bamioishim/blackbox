import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const get = vi.fn();
vi.mock("@1claw/sdk", () => ({ createClient: vi.fn(() => ({ secrets: { get } })) }));

import { getSecret, accessLog, _resetVaultForTests, VAULT_PATHS } from "@/lib/vault";

const VALUE = "serv_test_value_that_must_never_be_logged";

describe("1Claw just-in-time secrets", () => {
  beforeEach(() => {
    _resetVaultForTests();
    get.mockReset();
    delete process.env.DATABASE_URL;
    process.env.ONECLAW_VAULT_ID = "vault-1";
    process.env.ONECLAW_AGENT_ID = "agent-1";
    process.env.ONECLAW_AGENT_API_KEY = "ocv_test";
    process.env.ONECLAW_MONTHLY_CAP = "30";
  });
  afterEach(() => {
    for (const k of ["ONECLAW_VAULT_ID", "ONECLAW_AGENT_ID", "ONECLAW_AGENT_API_KEY", "ONECLAW_MONTHLY_CAP", "SERV_API_KEY"]) delete process.env[k];
  });

  it("fetches a path once per process, then serves it from memory", async () => {
    get.mockResolvedValue({ data: { value: VALUE }, error: null, meta: { status: 200 } });
    expect(await getSecret("serv")).toBe(VALUE);
    expect(await getSecret("serv")).toBe(VALUE);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("vault-1", VAULT_PATHS.serv);
  });

  it("ignores the legacy env var when 1Claw is configured", async () => {
    process.env.SERV_API_KEY = "legacy";
    get.mockResolvedValue({ data: { value: VALUE }, error: null, meta: { status: 200 } });
    expect(await getSecret("serv")).toBe(VALUE);
  });

  it("access log names the path and never the value", async () => {
    get.mockResolvedValue({ data: { value: VALUE }, error: null, meta: { status: 200 } });
    await getSecret("buyer");
    const log = await accessLog();
    expect(log.entries[0]).toMatchObject({ path: VAULT_PATHS.buyer, source: "1claw" });
    expect(JSON.stringify(log)).not.toContain(VALUE);
    expect(log.callsThisMonth).toBe(2); // token exchange + one GET
  });

  it("refuses to call 1Claw past the monthly cap", async () => {
    process.env.ONECLAW_MONTHLY_CAP = "1";
    await expect(getSecret("anchor")).rejects.toThrow(/budget/);
    expect(get).not.toHaveBeenCalled();
  });

  it("surfaces a 1Claw refusal instead of a silent undefined", async () => {
    get.mockResolvedValue({ data: null, error: { type: "forbidden", message: "no" }, meta: { status: 403 } });
    await expect(getSecret("seller")).rejects.toThrow(/403/);
  });

  it("falls back to the env var only when 1Claw is not configured", async () => {
    delete process.env.ONECLAW_VAULT_ID;
    process.env.SERV_API_KEY = "local-dev";
    expect(await getSecret("serv")).toBe("local-dev");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("ONECLAW_SECRETS scoping", () => {
  beforeEach(() => {
    _resetVaultForTests();
    get.mockReset();
    process.env.ONECLAW_VAULT_ID = "v"; process.env.ONECLAW_AGENT_ID = "a"; process.env.ONECLAW_AGENT_API_KEY = "ocv_x";
    process.env.ONECLAW_SECRETS = "serv";
  });
  afterEach(() => { for (const k of ["ONECLAW_VAULT_ID", "ONECLAW_AGENT_ID", "ONECLAW_AGENT_API_KEY", "ONECLAW_SECRETS", "BLACKBOX_BUYER_AGENT_KEY"]) delete process.env[k]; });

  it("reads unscoped secrets from env and never asks 1Claw for them", async () => {
    process.env.BLACKBOX_BUYER_AGENT_KEY = "envkey";
    expect(await getSecret("buyer")).toBe("envkey");
    expect(get).not.toHaveBeenCalled();
  });

  it("remembers a refusal instead of retrying every deal", async () => {
    get.mockResolvedValue({ data: null, error: { type: "auth_error", message: "no" }, meta: { status: 403 } });
    await expect(getSecret("serv")).rejects.toThrow(/403/);
    await expect(getSecret("serv")).rejects.toThrow(/403/);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
