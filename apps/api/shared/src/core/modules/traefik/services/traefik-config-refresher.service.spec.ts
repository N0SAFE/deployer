import { describe, expect, it, vi } from "vitest";
import type { SupervisorOrchestratorService } from "@deployer/nest-supervisor-core/supervisor-orchestrator.service";

import { EdgeConnectorSupervisorService } from "../../supervisors/platform/edge-connector-supervisor.service";
import { TraefikSupervisorService } from "../../supervisors/platform/traefik-supervisor.service";
import { TraefikConfigRefresher } from "./traefik-config-refresher.service";

describe("TraefikConfigRefresher", () => {
	it("re-converges the ingress and the tunnel connectors", async () => {
		const convergeNow = vi.fn(() => Promise.resolve("converged" as const));
		new TraefikConfigRefresher({ convergeNow } as unknown as SupervisorOrchestratorService).refresh();

		await vi.waitFor(() => { expect(convergeNow).toHaveBeenCalledTimes(2); });
		expect(convergeNow).toHaveBeenNthCalledWith(1, TraefikSupervisorService.getIdentifier());
		expect(convergeNow).toHaveBeenNthCalledWith(2, EdgeConnectorSupervisorService.getIdentifier());
	});

	it("never throws, and still re-converges the connectors when the ingress fails", async () => {
		const convergeNow = vi
			.fn()
			.mockRejectedValueOnce(new Error("engine down"))
			.mockResolvedValueOnce("converged");
		const refresher = new TraefikConfigRefresher({ convergeNow } as unknown as SupervisorOrchestratorService);
		// `logger` is private by design; the test asserts on a logged warning, so it reads
                // the instance through a typed view rather than widening the member for tests.
                const warn = vi.spyOn(refresher["logger"], "warn").mockImplementation(() => undefined);

		expect(() => {
			refresher.refresh();
		}).not.toThrow();
		await vi.waitFor(() => { expect(convergeNow).toHaveBeenCalledTimes(2); });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("engine down"));
	});
});
