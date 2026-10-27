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
vi.mock("../project.module", () => ({ ProjectDomainModule: {} }));

import { ProjectController } from "./project.controller";

describe("ProjectController", () => {
	let controller: ProjectController;

	beforeEach(() => {
		controller = new ProjectController();
	});

	it.each([
		["list", () => controller.list()],
		["findById", () => controller.findById()],
		["create", () => controller.create()],
		["update", () => controller.update()],
		["delete", () => controller.delete()],
		["getCollaborators", () => controller.getCollaborators()],
		["inviteCollaborator", () => controller.inviteCollaborator()],
		["updateCollaborator", () => controller.updateCollaborator()],
		["removeCollaborator", () => controller.removeCollaborator()],
		["listEnvironments", () => controller.listEnvironments()],
		["getEnvironment", () => controller.getEnvironment()],
		["createEnvironment", () => controller.createEnvironment()],
		["updateEnvironment", () => controller.updateEnvironment()],
		["deleteEnvironment", () => controller.deleteEnvironment()],
		["cloneEnvironment", () => controller.cloneEnvironment()],
		["listServiceEnvironmentLinks", () => controller.listServiceEnvironmentLinks()],
		["upsertServiceEnvironmentLink", () => controller.upsertServiceEnvironmentLink()],
		["getNetwork", () => controller.getNetwork()],
		["updateNetwork", () => controller.updateNetwork()],
		["listVariableTemplates", () => controller.listVariableTemplates()],
		["getVariableTemplate", () => controller.getVariableTemplate()],
		["createVariableTemplate", () => controller.createVariableTemplate()],
		["updateVariableTemplate", () => controller.updateVariableTemplate()],
		["deleteVariableTemplate", () => controller.deleteVariableTemplate()],
		["getGeneralConfig", () => controller.getGeneralConfig()],
		["updateGeneralConfig", () => controller.updateGeneralConfig()],
		["getEnvironmentConfig", () => controller.getEnvironmentConfig()],
		["updateEnvironmentConfig", () => controller.updateEnvironmentConfig()],
		["getDeploymentConfig", () => controller.getDeploymentConfig()],
		["updateDeploymentConfig", () => controller.updateDeploymentConfig()],
		["getSecurityConfig", () => controller.getSecurityConfig()],
		["updateSecurityConfig", () => controller.updateSecurityConfig()],
		["getResourceConfig", () => controller.getResourceConfig()],
		["updateResourceConfig", () => controller.updateResourceConfig()],
		["getNotificationConfig", () => controller.getNotificationConfig()],
		["updateNotificationConfig", () => controller.updateNotificationConfig()],
		["getEnvironmentStatus", () => controller.getEnvironmentStatus()],
		["getAllEnvironmentStatuses", () => controller.getAllEnvironmentStatuses()],
		["refreshEnvironmentStatus", () => controller.refreshEnvironmentStatus()],
		["streamQuery", () => controller.streamQuery()],
	])("binds %s to a handler", (_name, build) => {
		const procedure = build() as unknown as { handler: unknown };
		expect(typeof procedure.handler).toBe("function");
	});
});
