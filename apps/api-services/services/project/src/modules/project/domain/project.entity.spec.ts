import { describe, expect, it } from "vitest";

import { ForbiddenError, ValidationError } from "@deployer/errors";

import { projectRules, type ProjectRole } from "./project.entity";

/** A project owned by somebody else, so collaborator roles decide. */
const project = { id: "p1", ownerId: "owner-user" };
const actor = "actor";

const asCollaborator = (role: ProjectRole) => ({ role });

describe("projectRules — the role vocabulary", () => {
	/**
	 * The regression this file exists for. The service used to gate on `"admin"`
	 * and `"developer"`, neither of which the permission builder defines — so
	 * `allowedRoles.includes(role)` never matched and a `maintainer` or `deployer`
	 * was denied every operation on a project they had been invited to.
	 */
	it("does not know the roles that only ever existed in the service layer", () => {
		expect(projectRules.isRole("admin")).toBe(false);
		expect(projectRules.isRole("developer")).toBe(false);
	});

	it("knows every role the permission builder defines", () => {
		expect([...projectRules.roles]).toEqual([
			"owner",
			"maintainer",
			"deployer",
			"viewer",
		]);
	});
});

describe("projectRules.assertAccess", () => {
	/** A maintainer must be able to manage a project — the bug locked them out. */
	it("lets a maintainer manage and administer", () => {
		expect(projectRules.assertAccess(project, actor, asCollaborator("maintainer"), "manage")).toBe("maintainer");
		expect(projectRules.assertAccess(project, actor, asCollaborator("maintainer"), "admin")).toBe("maintainer");
	});

	/** A deployer ships, but must not reconfigure the project. */
	it("lets a deployer deploy but not manage", () => {
		expect(projectRules.assertAccess(project, actor, asCollaborator("deployer"), "deploy")).toBe("deployer");
		expect(() =>
			projectRules.assertAccess(project, actor, asCollaborator("deployer"), "manage"),
		).toThrow(ForbiddenError);
	});

	/** A viewer reads and nothing else. */
	it("lets a viewer read only", () => {
		expect(projectRules.assertAccess(project, actor, asCollaborator("viewer"), "read")).toBe("viewer");
		for (const access of ["deploy", "manage", "admin"] as const) {
			expect(() => projectRules.assertAccess(project, actor, asCollaborator("viewer"), access)).toThrow(ForbiddenError);
		}
	});

	/**
	 * Ownership is a property of the row, not of a membership record: an owner
	 * with no collaborator row must still have full access.
	 */
	it("gives the owner full access with no collaborator record", () => {
		for (const access of ["read", "deploy", "manage", "admin"] as const) {
			expect(projectRules.assertAccess(project, "owner-user", null, access)).toBe("owner");
		}
	});

	/** A stranger has no role, so nothing is allowed. */
	it("refuses a caller with no membership at all", () => {
		expect(() => projectRules.assertAccess(project, actor, null, "read")).toThrow(ForbiddenError);
	});
});

describe("projectRules — ownership is not transferable through the membership API", () => {
	it("refuses to delete unless the caller is the owner", () => {
		expect(() => projectRules.assertCanDelete(project, "owner-user")).not.toThrow();
		expect(() => projectRules.assertCanDelete(project, actor)).toThrow(ForbiddenError);
	});

	it("refuses to edit or remove the owner's membership", () => {
		expect(() => projectRules.assertNotOwnerMembership(asCollaborator("owner"), "modify")).toThrow(ForbiddenError);
		expect(() => projectRules.assertNotOwnerMembership(asCollaborator("maintainer"), "modify")).not.toThrow();
	});

	it("refuses to grant ownership via a role patch", () => {
		expect(() => projectRules.assertNotOwnerGrant("owner")).toThrow(ForbiddenError);
		expect(() => projectRules.assertNotOwnerGrant("maintainer")).not.toThrow();
		expect(() => projectRules.assertNotOwnerGrant(undefined)).not.toThrow();
	});
});

describe("projectRules.assertRoleIsAssignable", () => {
	it("rejects a role the platform does not define", () => {
		expect(() => projectRules.assertRoleIsAssignable("admin")).toThrow(ValidationError);
	});

	it("accepts every defined role", () => {
		for (const role of projectRules.roles) {
			expect(() => projectRules.assertRoleIsAssignable(role)).not.toThrow();
		}
	});
});
