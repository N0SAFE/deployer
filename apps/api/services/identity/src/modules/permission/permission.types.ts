import type { roleRules } from '@deployer/nest-schema/global/identity/permissions'

import type { InferSelectModel } from 'drizzle-orm'

/** One `role_rules` row as Drizzle returns it. */
export type RoleRuleRow = InferSelectModel<typeof roleRules>
