import { relations } from 'drizzle-orm'
import { pgEnum } from 'drizzle-orm/pg-core'

import { PROJECT_ROLES } from '@deployer/auth'
import { sourceTypeSchema } from '@deployer/contracts-common'
import type { NetworkDnsRecordType } from '@deployer/contracts-entities'
import { user } from '@deployer/nest-schema/global/identity/auth'
import { environments } from '@deployer/nest-schema/global/project/environment'
import { zodEnumToPgEnumValues } from '@deployer/nest-schema/global/utils/zod-enum'

import { encryptedText } from '../../codecs/codec-registry'
import { traefikConfigBuilder } from '../../codecs/codec-registry'
export const sourceTypeEnum = pgEnum('source_type', [
    ...zodEnumToPgEnumValues(sourceTypeSchema),
])
