import { inspectKiteAgentKey, KITE_AGENTS, short } from "../src/lib/identity";

const sides = ["buyer", "seller"] as const;
const labels = {
  missing: "MISSING KEY",
  malformed: "MALFORMED KEY",
  invalid: "INVALID PRIVATE KEY",
  mismatch: "ADDRESS MISMATCH",
  match: "KEY MATCH (LOCAL ONLY)",
} as const;
let failed = false;

for (const side of sides) {
  const result = inspectKiteAgentKey(side);
  const did = KITE_AGENTS[side].did;
  const address = result.derivedAddress ? ` | derived ${short(result.derivedAddress, 8, 6)}` : "";
  console.log(`${side}: ${labels[result.status]} | ${did}${address}`);
  if (result.status !== "match") {
    failed = true;
    if (result.status === "mismatch") {
      console.error(`  Expected ${short(result.expectedAddress, 8, 6)}; configure the private key for this registered runtime address.`);
    } else if (result.status === "missing") {
      console.error(`  Set BLACKBOX_${side.toUpperCase()}_AGENT_KEY in the server's secret store.`);
    } else {
      console.error(`  BLACKBOX_${side.toUpperCase()}_AGENT_KEY must be a valid 32-byte secp256k1 private key.`);
    }
  }
}

console.log("\nThis check derives public addresses locally. It never prints private keys and does not query or prove active Kite Passport binding status.");
if (failed) {
  console.error("\nKite key readiness check failed. Correct the server-side secrets, verify each agent's active binding in Kite Passport, then rerun this check.");
  process.exitCode = 1;
} else {
  console.log("Both configured private keys match the public runtime addresses recorded in Blackbox. Confirm the active Passport bindings separately.");
}
