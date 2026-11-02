import { describe, expect, it, vi } from "vitest";

import type { NodeDoorClient } from "@deployer/mesh-client";
import type { NodeConfigRepositoryShape } from "@deployer/node-state";
import type { SwarmBootstrapShape, SwarmClusterShape } from "@deployer/swarm";

import { RemoteInitializationService } from "./remote-initialization.service";
import { SetupStepTracker } from "./setup-step-tracker";

import type { EnvService } from "../../../../config/env/env.module";
import type { ClientContext, ClientLink } from "@orpc/client";


const noop = () => undefined;

/** The `agent_join` step is the first thing the flow does, so a redeem that rejects is enough to observe the token. */
function serviceWith(joinWithToken: (token: string) => Promise<unknown>, agent?: ClientLink<ClientContext>) {
    class Testable extends RemoteInitializationService {
        protected override nodeDoor(): NodeDoorClient {
            return { joinWithToken } as unknown as NodeDoorClient;
        }
        protected override agentLink(): ClientLink<ClientContext> | undefined {
            return agent;
        }
    }
    return new Testable(
        { find: () => Promise.resolve(null) } as unknown as NodeConfigRepositoryShape,
        { get: noop } as unknown as EnvService,
        {} as SwarmBootstrapShape,
        {} as SwarmClusterShape,
    );
}

const input = { strategy: "remote" as const, token: "platform-grant", serverUrl: "https://node.example.com" };

describe("RemoteInitializationService join token", () => {
    it("redeems the agent's own token when setup received it", async () => {
        const redeem = vi.fn(() => Promise.reject(new Error("stop here")));
        const service = serviceWith(redeem);

        await expect(service.initialize({ ...input, meshJoinToken: "agent-join-token" }, new SetupStepTracker(), vi.fn())).rejects.toThrow(
            "stop here",
        );
        expect(redeem).toHaveBeenCalledWith("agent-join-token");
    });

    it("falls back to the platform token when no agent token was passed", async () => {
        const redeem = vi.fn(() => Promise.reject(new Error("stop here")));
        const service = serviceWith(redeem);

        await expect(service.initialize(input, new SetupStepTracker(), vi.fn())).rejects.toThrow("stop here");
        expect(redeem).toHaveBeenCalledWith("platform-grant");
    });
});
