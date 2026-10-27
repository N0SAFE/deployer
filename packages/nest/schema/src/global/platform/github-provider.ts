import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { encryptedText } from '../../codecs/codec-registry';
import { projects } from "@deployer/nest-schema/global/project/deployment";
import {
  cacheStrategySchema,
  githubDeploymentStrategySchema,
  previewDeploymentStatusSchema,
} from '@deployer/contracts-common';
import { zodEnumToPgEnumValues } from "@deployer/nest-schema/global/utils/zod-enum";

export const cacheStrategyEnum = pgEnum('cache_strategy', [...zodEnumToPgEnumValues(cacheStrategySchema)]);
