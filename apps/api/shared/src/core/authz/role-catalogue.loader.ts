import { eq } from 'drizzle-orm'

import { authzEpoch, roles } from '@deployer/nest-schema/global/identity/index'

import type { CatalogueRole } from './role-catalog'
import type { GlobalDatabase } from '../modules/database/global/global-database.service'

/** The catalogue as the table holds it: platform-scoped roles and the epoch they were read at. */
export type RoleCatalogue = {
    readonly epoch: number
    readonly roles: readonly CatalogueRole[]
}

/**
 * Read the permission catalogue from the `roles` table.
 *
 * Platform-scoped rows only: a project role is a MEMBERSHIP (`project_collaborators`), owned by the project service, and
 * is never a platform capability — mixing them is how a project "admin" would inherit platform administration.
 *
 * Two statements, no join: the epoch row is a singleton and the roles are a handful of rows.
 */
export async function loadRoleCatalogue(
    db: GlobalDatabase
): Promise<RoleCatalogue> {
    const [epochRow] = await db
        .select()
        .from(authzEpoch)
        .where(eq(authzEpoch.id, 'global'))
        .limit(1)
    const rows = await db
        .select({ name: roles.name, permissions: roles.permissions })
        .from(roles)
        .where(eq(roles.scope, 'platform'))

    return {
        epoch: epochRow?.value ?? 1,
        roles: rows.map((row) => ({
            name: row.name,
            permissions: [...row.permissions],
        })),
    }
}
