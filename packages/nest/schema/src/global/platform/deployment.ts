import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { environments } from "@deployer/nest-schema/global/project/environment";
import { encryptedText } from "../../codecs/codec-registry";
import { traefikConfigBuilder } from "../../codecs/codec-registry";
import {
    deploymentEnvironmentSchema,
    deploymentPhaseSchema,
    deploymentStatusSchema,
    logLevelSchema,
    rollbackStatusSchema,
    serviceProviderTypeSchema,
    serviceRunnerTypeSchema,
    serviceTypeSchema,
    sourceTypeSchema,
} from "@deployer/contracts-common";
import type { NetworkDnsRecordType } from "@deployer/contracts-entities";
import { zodEnumToPgEnumValues } from "@deployer/nest-schema/global/utils/zod-enum";
import { PROJECT_ROLES } from "@deployer/auth";
export const sourceTypeEnum = pgEnum("source_type", [...zodEnumToPgEnumValues(sourceTypeSchema)]);
