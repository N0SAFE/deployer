import "reflect-metadata";
import type { Server } from "node:http";
import "@orpc/effect/extensions/effect";
// The oRPC context augmentation (`context.request`, `context.auth`), imported for its side effect and as
// `@deployer/shared/core/...` so it is the SAME module identity the shared code resolves.
import "@deployer/shared/core/orpc/context";

import { DEPENDENCIES, DependencyNotReadyError, apiServicePort, bootstrapApiServer } from "@deployer/shared/server";

import { MeshAgentServiceModule } from "./app.module";
import { startMeshTransport } from "./transport/mesh-transport";

/** The port comes from the shared catalog, so the agent listens where everything else addresses it. */
const PORT = apiServicePort("mesh-agent");
const NAME = "svc-mesh-agent";

/**
 * An agent declares no dependency to prove: it needs neither a database nor Redis, and requiring one would make it
 * un-startable on a node that is not in a swarm yet.
 */
void bootstrapApiServer({
  rootModule: MeshAgentServiceModule,
  port: PORT,
  name: NAME,
  dependencies: DEPENDENCIES.none,
})
  .then(async (app) => {
    // The port is bound: serve the mesh websocket on it and start gossiping. Closing the app ends both.
    const transport = await startMeshTransport(app);
    (app.getHttpServer() as Server).once("close", () => void transport.stop());
  })
  .catch((error: unknown) => {
  if (error instanceof DependencyNotReadyError) {
    console.error(error.message);
    process.exit(5);
  }
  console.error(error);
  process.exit(1);
});
