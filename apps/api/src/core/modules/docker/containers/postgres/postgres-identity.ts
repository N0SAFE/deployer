import { splitManagedEnv } from "@repo/env";
import { MANAGED_POSTGRES_IMAGE, type PostgresIdentityConfig } from "@repo/nest-docker";

import type { EnvService } from "@/config/env/env.module";

/**
 * Resolve the Postgres identity from THE API'S environment.
 *
 * This lives in the app, not in `@repo/nest-docker`, because it decides WHERE
 * the values come from — the managed-service block of this app's env schema.
 * The package declares the SHAPE it needs (`PostgresIdentityConfig`) and takes
 * the resulting data; it never reads an env var.
 *
 * `MANAGED_POSTGRES_IMAGE` is the package's own constant: which Postgres image
 * to provision is part of how the package provisions, not a per-app decision.
 *
 * Background: a previous volume could be initialised with a different
 * `POSTGRES_USER`, and Postgres only applies `POSTGRES_*` on FIRST init — so a
 * mismatch surfaced as `password authentication failed for user "postgres"`
 * against a healthy database. The identity must therefore match whatever the
 * existing volume was created with.
 */
export function resolvePostgresIdentity(env: EnvService): PostgresIdentityConfig {
    const managed = splitManagedEnv(env).globalDb;
    return {
        databaseName: managed.name,
        username: managed.user,
        password: managed.password,
        image: MANAGED_POSTGRES_IMAGE,
    };
}
