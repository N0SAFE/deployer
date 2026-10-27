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
vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", () => ({
	requireAuth: () => ({}),
}));
vi.mock("../service.module", () => ({ ServiceDomainModule: {} }));

import { ServiceController } from "./service.controller";

describe("ServiceController", () => {
	let controller: ServiceController;

	beforeEach(() => {
		controller = new ServiceController();
	});

	it.each([
		["list", () => controller.list()],
		["findById", () => controller.findById()],
		["create", () => controller.create()],
		["update", () => controller.update()],
		["delete", () => controller.delete()],
		["children", () => controller.children()],
		["subtree", () => controller.subtree()],
		["toggleActive", () => controller.toggleActive()],
		["getDependencies", () => controller.getDependencies()],
		["addDependency", () => controller.addDependency()],
		["removeDependency", () => controller.removeDependency()],
		["streamQuery", () => controller.streamQuery()],
		["previewTopologyResolve", () => controller.previewTopologyResolve()],
		["networkGet", () => controller.networkGet()],
		["networkUpdate", () => controller.networkUpdate()],
		["networkProvisionRecord", () => controller.networkProvisionRecord()],
	])("binds %s to a handler", (_name, build) => {
		const procedure = build() as unknown as { handler: unknown };
		expect(typeof procedure.handler).toBe("function");
	});
});
