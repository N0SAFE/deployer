import {
    countStoredKeys,
    findEncryptedColumns,
    makePgResealStore,
    type PgQueryable,
    type StoredKeyReport,
} from '@deployer/nest-schema/codecs/reseal'
import * as globalSchema from '@deployer/nest-schema/global'

/**
 * How many stored values sit under each key generation, across every encrypted column of the shared database.
 *
 * It lives here and not in a service because the question is cross-cutting by nature: the encrypted columns belong to several
 * services (provider credentials, environment variables, webhooks, …), and a service may not read tables it does not own. The
 * reseal command does the same sweep for the same reason. Columns are found by probing the schema, so one added later is
 * counted without anyone listing it; and only COUNTS are read, never a value.
 */
export function storedSecretsReport(pool: PgQueryable): Promise<StoredKeyReport> {
    return countStoredKeys(
        makePgResealStore(pool),
        findEncryptedColumns(globalSchema).targets
    )
}
