import { mintAgent, KITE_OWNER } from "../src/lib/identity";

const sides = ["buyer", "seller"] as const;
let failed = false;

for (const side of sides) {
  const signer = mintAgent(side, KITE_OWNER);
  const { identity } = signer;
  const expected = identity.kiteAgent?.did ?? "missing DID";
  const configured = Boolean(process.env[`BLACKBOX_${side.toUpperCase()}_AGENT_KEY`]?.trim());
  const matched = identity.binding.status === "bound";
  console.log(`${side}: ${matched ? "BOUND" : "NOT BOUND"} | DID ${expected} | key configured: ${configured}`);
  if (!matched) failed = true;
}

if (failed) {
  console.error("\nKite identity check failed. Configure each BLACKBOX_*_AGENT_KEY with the private key whose address exactly matches the registered Kite runtime key, then rerun this check. Never commit or print the private keys.");
  process.exitCode = 1;
} else {
  console.log("\nBoth agent runtime keys match their registered Kite Passport runtime addresses.");
}
