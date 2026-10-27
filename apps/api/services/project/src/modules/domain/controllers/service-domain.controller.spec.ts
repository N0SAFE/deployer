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

import { ServiceDomainController } from "./service-domain.controller";

describe("ServiceDomainController", () => {
	let controller: ServiceDomainController;

	beforeEach(() => {
		controller = new ServiceDomainController();
	});

	it.each([
		[
			"checkSubdomainAvailability",
			() => controller.checkSubdomainAvailability(),
		],
		["listServiceDomains", () => controller.listServiceDomains()],
		["addServiceDomain", () => controller.addServiceDomain()],
		["updateServiceDomain", () => controller.updateServiceDomain()],
		["setPrimaryServiceDomain", () => controller.setPrimaryServiceDomain()],
		["removeServiceDomain", () => controller.removeServiceDomain()],
	])("binds %s to a handler", (_name, build) => {
		const procedure = build() as unknown as { handler: unknown };
		expect(typeof procedure.handler).toBe("function");
	});
});
