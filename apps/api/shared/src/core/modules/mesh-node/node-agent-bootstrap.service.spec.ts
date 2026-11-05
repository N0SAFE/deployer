import { describe, expect, it } from "vitest";

import { isDockerSocketMissing } from "./node-agent-bootstrap.service";

describe("isDockerSocketMissing", () => {
	it("recognises a service that has no Docker socket mounted", () => {
		expect(isDockerSocketMissing("Failed to inspect container deployer-node-agent: connect ENOENT /var/run/docker.sock")).toBe(true);
	});

	it("keeps real failures loud", () => {
		expect(isDockerSocketMissing("Failed to pull image deployer-svc-node-agent:dev: pull access denied")).toBe(false);
		expect(isDockerSocketMissing("connect EACCES /var/run/docker.sock")).toBe(false);
	});
});
