import type { environments, variableTemplates } from "@deployer/nest-schema/global/project/environment";
import type { projectCollaborators, projects } from "@deployer/nest-schema/global/project/deployment";
import type { z } from "zod/v4";
import type { projectRoleSchema } from "@deployer/contracts-entities";

// ---------------------------------------------------------------------------
// Row types (derived from Drizzle schema)
// ---------------------------------------------------------------------------

export type ProjectRow = typeof projects.$inferSelect;
export type CollaboratorRow = typeof projectCollaborators.$inferSelect;
export type EnvironmentRow = typeof environments.$inferSelect;
export type TemplateRow = typeof variableTemplates.$inferSelect;

/** The canonical project role, derived from the contract. */
export type ProjectRole = z.infer<typeof projectRoleSchema>;

// ---------------------------------------------------------------------------
// Input types (derived from the Drizzle schema)
// ---------------------------------------------------------------------------

export type ProjectCreateInput = Pick<ProjectRow, "name" | "ownerId"> & {
	description?: string | null;
	baseDomain?: string | null;
	network?: ProjectRow["network"];
	settings?: ProjectRow["settings"];
};

export type ProjectUpdateInput = Partial<
	Pick<ProjectRow, "name" | "description" | "baseDomain" | "network" | "settings">
>;

export type CollaboratorCreateInput = {
	projectId: string;
	userId: string;
	role: ProjectRole;
	permissions?: CollaboratorRow["permissions"];
	invitedBy: string;
};

export type CollaboratorUpdateInput = Partial<{
	role: ProjectRole;
	permissions: CollaboratorRow["permissions"];
}>;

export type EnvironmentCreateInput = {
	projectId: string;
	name: string;
	/** The primitive KIND: stable | preview | ephemeral. */
	kind: "stable" | "preview" | "ephemeral";
	/** Legacy built-in name (back-compat), e.g. development for custom envs. */
	type?: "production" | "staging" | "preview" | "development";
	/** Per-env rules (profiles, autoDeploy, strategy…). */
	rules?: EnvironmentRow["rules"];
	/** Trigger for preview/ephemeral envs. */
	trigger?: EnvironmentRow["trigger"];
	description?: string | null;
	domainConfig?: EnvironmentRow["domainConfig"];
	deploymentConfig?: EnvironmentRow["deploymentConfig"];
	metadata?: EnvironmentRow["metadata"];
	createdBy: string;
};

export type EnvironmentUpdateInput = Partial<{
	name: string;
	kind: "stable" | "preview" | "ephemeral";
	type: "production" | "staging" | "preview" | "development";
	rules: EnvironmentRow["rules"];
	trigger: EnvironmentRow["trigger"];
	description: string | null;
	domainConfig: EnvironmentRow["domainConfig"];
	deploymentConfig: EnvironmentRow["deploymentConfig"];
	metadata: EnvironmentRow["metadata"];
}>;

export type TemplateCreateInput = {
	name: string;
	description?: string | null;
	variables?: TemplateRow["variables"];
	createdBy: string;
};

export type TemplateUpdateInput = Partial<{
	name: string;
	description: string | null;
	variables: TemplateRow["variables"];
}>;
