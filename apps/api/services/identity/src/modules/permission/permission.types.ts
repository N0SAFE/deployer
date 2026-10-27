import type { InferSelectModel } from "drizzle-orm";
import type { roleRules } from "@deployer/nest-schema/global/identity/permissions";

/** One `role_rules` row as Drizzle returns it. */
export type RoleRuleRow = InferSelectModel<typeof roleRules>;
