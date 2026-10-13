import "reflect-metadata";
// The oRPC context augmentation (`context.request`, `context.auth`) — imported
// for its side effect, and imported as `@/core/...` so it is the SAME module
// identity the shared code resolves. Importing it by the package name instead
// would load a second copy and leave this app's handlers typed against an
// un-augmented context.
import "@/core/orpc/context";

import { bootstrapApiServer, DependencyNotReadyError, DEPENDENCIES } from "@deployer/shared/server";

import { BffModule } from "./bff.module";

/**
 * The BFF's process entry point.
 *
 * The port comes from `API_PORT` — the SAME variable the monolith used, because
 * the BFF inherits the monolith's public role: whatever Traefik routed to the
 * API before routes to the BFF now, so the ingress config and the web client
 * need no change.
 */
const BFF_PORT = Number(process.env.API_PORT ?? 3005);

/**
 * The BFF is the process that answers for the platform, so it declares the FULL
 * dependency set: the global Postgres (with the schema migrated) and Redis. A
 * BFF that binds its port without those would happily forward requests into
 * services that are about to fail them — and being the health roll-up's owner,
 * it would be the thing reporting the platform as fine.
 */
void bootstrapApiServer({
        rootModule: BffModule,
        port: BFF_PORT,
        name: "api-bff",
        dependencies: DEPENDENCIES.platform,
}).catch((error: unknown) => {
        // A missing dependency is a KNOWN, reportable condition — not an
        // unhandled boot crash. Exit 5 (the documented "engine/dependency
        // unavailable" code) so the orchestrator and the swarm can branch on it
        // without parsing a stack trace.
        if (error instanceof DependencyNotReadyError) {
                console.error(error.message);
                process.exit(5);
        }
        console.error(error);
        process.exit(1);
});
