import { RPCLink } from "@orpc/client/message-port";
import { os, type RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as z from "zod";

import { grantDirect } from "@deployer/mesh-agent-contracts";

import { grantFollowingLink } from "./grant-link";
import { createMeshClient } from "./mesh-client";

import type { ClientContext } from "@orpc/client";

/**
 * The caller side end to end over real oRPC RPC peers (in-memory ports instead of sockets): a service built with
 * `createMeshClient` asks the "agent", is handed a grant, and the same call is replayed on the replica.
 */
const echo = os.input(z.object({ text: z.string() })).handler(({ input }) => ({ text: input.text }));

const agentRouter = {
  echo: os.input(z.object({ text: z.string() })).handler(() => {
    throw grantDirect({ replicaId: "runtime-2", address: "mem://runtime-2", token: "t1", expiresAt: Date.now() + 60_000 });
  }),
};
const replicaRouter = { echo };

function serve(router: typeof agentRouter | typeof replicaRouter) {
  const { port1, port2 } = new MessageChannel();
  new RPCHandler(router).upgrade(port1);
  port1.start();
  port2.start();
  return new RPCLink<ClientContext>({ port: port2 });
}

describe("createMeshClient", () => {
  it("returns Effects, and a granted call is replayed on the replica", async () => {
    const replica = serve(replicaRouter);
    const link = grantFollowingLink<ClientContext>({ agent: serve(agentRouter), direct: () => replica });
    const client = createMeshClient<RouterClient<typeof replicaRouter>>(link);

    const result = await Effect.runPromise(client.echo({ text: "hello" }));

    expect(result).toEqual({ text: "hello" });
  });
});
