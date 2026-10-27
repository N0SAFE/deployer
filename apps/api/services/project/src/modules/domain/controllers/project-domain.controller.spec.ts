import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@orpc/nest", () => ({ Implement: () => () => undefined }));
vi.mock("@orpc/server", () => {
	const builder = {
		use: () => builder,
		effect: (handler: unknown) => ({ handler }),
	};
	return { implement: () => builder };
});
vi.mock("@deployer/nest-effect", () => ({
	EffectContextOf: Symbol("effect/context"),
}));
vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
	requireAuth: () => ({}),
}));
vi.mock("../domain.module", () => ({ DomainModule: {} }));

import { ProjectDomainController } from "./project-domain.controller";

describe("ProjectDomainController", () => {
	let controller: ProjectDomainController;

	beforeEach(() => {
		controller = new ProjectDomainController();
	});

	it.each([
		["listProjectDomains", () => controller.listProjectDomains()],
		["getAvailableDomains", () => controller.getAvailableDomains()],
		[
			"getAvailableDomainsForService",
			() => controller.getAvailableDomainsForService(),
		],
		["addProjectDomain", () => controller.addProjectDomain()],
		["updateProjectDomain", () => controller.updateProjectDomain()],
		["removeProjectDomain", () => controller.removeProjectDomain()],
		["verifyProjectDomain", () => controller.verifyProjectDomain()],
	])("binds %s to a handler", (_name, build) => {
		const procedure = build() as unknown as { handler: unknown };
		expect(typeof procedure.handler).toBe("function");
	});
});
