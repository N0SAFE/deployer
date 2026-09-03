/**
 * Runtime proof that the node's public-address verification works:
 *   - a reachable address (this node's own API) → valid
 *   - a bogus/unreachable address → invalid with a helpful reason
 *
 * Calls the REAL ReachabilityService.verifyPublicAddress method.
 * Run with:  bun --bun run scripts/public-address-verify-proof.ts
 */
import { ReachabilityService } from "../src/core/modules/reachability/services/reachability.service";

let failures = 0;
function assert(cond: boolean, label: string): void {
    if (cond) console.log(`  ✅ ${label}`);
    else { console.error(`  ❌ ${label}`); failures += 1; }
}

async function main(): Promise<void> {
    console.log("Public-address verification proof (runtime)\n");
    // verifyPublicAddress does not touch the DB — a stub is enough to construct.
    const service = new ReachabilityService({ db: {} } as never);

    console.log("1) This node's own address (reachable) → valid:");
    const ok = await service.verifyPublicAddress("http://localhost:3005");
    console.log(`    → valid=${String(ok.valid)} status=${String(ok.statusCode ?? "-")} latency=${String(ok.latencyMs ?? "-")}ms`);
    assert(ok.valid === true, "reachable address is accepted");

    console.log("2) A bogus, non-resolving host → invalid with reason:");
    const bad = await service.verifyPublicAddress("http://no-such-host-deployer-probe.invalid");
    console.log(`    → valid=${String(bad.valid)} reason="${bad.reason ?? ""}"`);
    assert(bad.valid === false, "unreachable address is rejected");
    assert(typeof bad.reason === "string" && bad.reason.length > 0, "failure carries a helpful reason");

    console.log("3) Empty/whitespace → invalid (never probed):");
    const empty = await service.verifyPublicAddress("   ");
    assert(empty.valid === false && empty.reason === "Address is empty", "empty address is rejected without probing");

    console.log(`\n${failures === 0 ? "ALL PROOFS PASSED" : `${String(failures)} PROOF(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
}

void main();
