import {
	environmentRulesSchema,
	projectNetworkConfigSchema,
} from "@deployer/contracts-entities";

import type {
	CollaboratorRow,
	EnvironmentRow,
	ProjectRole,
	ProjectRow,
	TemplateRow,
} from "./project.repository.types";

/**
 * Map legacy DB role names to the canonical project roles (SSOT:
 * `PROJECT_ROLES` from `@deployer/auth` → `projectRoleSchema`). The DB enum now
 * stores canonical names; the map preserves any legacy (`admin`, `developer`)
 * rows and guarantees the result is a canonical `ProjectRole`.
 */
const LEGACY_TO_CANONICAL_ROLE: Partial<Record<CollaboratorRow["role"], ProjectRole>> = {
	admin: "maintainer",
	developer: "deployer",
	owner: "owner",
	maintainer: "maintainer",
	deployer: "deployer",
	viewer: "viewer",
};

/** DB project row → the entity shape (dates as ISO strings, network defaults filled). */
export function transformProject(row: ProjectRow) {
	return {
		...row,
		// Fill per-project network defaults (DB null → entity requires the
		// full network object).
		network: row.network
			? projectNetworkConfigSchema.safeParse(row.network).success
				? row.network
				: projectNetworkConfigSchema.parse({})
			: null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function transformCollaborator(row: CollaboratorRow) {
	// ── THE FALLBACK WAS A TYPE HOLE *AND* A DATA BUG ──────────────────────
	// This used to be `LEGACY_TO_CANONICAL_ROLE[row.role] ?? (row.role)`. For an
	// unmapped legacy value (`admin`, `developer`) that returned the RAW legacy
	// string, so the mapped type widened to `string` — which is why every caller
	// expecting `ProjectRole` failed — and, at runtime, a caller could receive a role
	// the rest of the platform does not recognise.
	//
	// Every member of the legacy enum IS mapped above, so the fallback is unreachable
	// for a well-formed row. `viewer` is the safe landing place: it is the column's own
	// default and the least-privileged role, so an unexpected value fails closed.
	const role: ProjectRole = LEGACY_TO_CANONICAL_ROLE[row.role] ?? "viewer";
	return {
		...row,
		role,
		invitedAt: row.invitedAt.toISOString(),
		acceptedAt: row.acceptedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function transformEnvironment(row: EnvironmentRow) {
	return {
		...row,
		projectId: row.projectId,
		// Fill per-env rule defaults (the DB may store null → entity requires
		// the full rules object). `parse` yields a guaranteed EnvironmentRules
		// (defaults filled), so the returned `rules` is never null.
		rules: environmentRulesSchema.parse(row.rules ?? undefined),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function transformTemplate(row: TemplateRow) {
	return {
		...row,
		variables: (row.variables ?? []).map((v) => ({
			key: v.key,
			template: v.template,
			description: v.description ?? null,
			category: v.category ?? null,
			required: v.required ?? false,
			defaultValue: v.defaultValue ?? null,
		})),
		lastUsed: row.lastUsed?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
