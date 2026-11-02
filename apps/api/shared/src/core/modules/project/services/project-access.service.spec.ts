import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectAccessRepository, type ProjectAccessRepositoryShape } from "../repositories/project-access.repository";

import { ProjectAccessService } from "./project-access.service";

/** The service under test: the class IS the implementation, so a spec instantiates it. */
const access = new ProjectAccessService.live();

/** The repository as a value: the service yields it, so a spec hands in its own lookups. */
const repositoryOver = (
	project: { id: string; ownerId: string } | null,
	role: "owner" | "maintainer" | "deployer" | "member" | null,
): ProjectAccessRepositoryShape => ({
	findProjectById: () => Effect.succeed(project),
	findCollaboratorByUserAndProject: () => Effect.succeed(role === null ? null : { role }),
});

const check = (
	repository: ProjectAccessRepositoryShape,
	projectId = "proj-1",
	roles: readonly ("owner" | "maintainer" | "deployer" | "member")[] = ["owner", "maintainer"],
) => access.assertProjectAccess(projectId, "user-1", roles).pipe(Effect.provideService(ProjectAccessRepository, repository));

describe("ProjectAccessService", () => {
	it("lets the owner through without a collaborator row", async () => {
		const project = await Effect.runPromise(check(repositoryOver({ id: "proj-1", ownerId: "user-1" }, null)));

		expect(project).toEqual({ id: "proj-1", ownerId: "user-1" });
	});

	it("lets a collaborator whose role is allowed through", async () => {
		const project = await Effect.runPromise(check(repositoryOver({ id: "proj-1", ownerId: "someone-else" }, "maintainer")));

		expect(project.id).toBe("proj-1");
	});

	it("refuses a collaborator whose role is not allowed", async () => {
		const exit = await Effect.runPromiseExit(
			check(repositoryOver({ id: "proj-1", ownerId: "x" }, "member"), "proj-1", ["owner"]),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		expect(exit._tag === "Failure" ? String(exit.cause) : "").toContain("ProjectAccessDenied");
	});

	it("reports a missing project rather than refusing it", async () => {
		const tag = await Effect.runPromise(
			check(repositoryOver(null, null), "gone").pipe(
				Effect.catchTag("ProjectNotFound", (failure) => Effect.succeed(failure._tag)),
			),
		);

		expect(tag).toBe("ProjectNotFound");
	});

	it("refuses a caller who is neither the owner nor a collaborator", async () => {
		const projectId = await Effect.runPromise(
			check(repositoryOver({ id: "proj-1", ownerId: "x" }, null), "proj-1", ["owner"]).pipe(
				Effect.catchTag("ProjectAccessDenied", (failure) => Effect.succeed(failure.projectId)),
			),
		);

		expect(projectId).toBe("proj-1");
	});
});
