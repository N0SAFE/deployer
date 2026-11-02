import { relations } from 'drizzle-orm';
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


import {
  cacheStrategySchema,
  githubDeploymentStrategySchema,
  previewDeploymentStatusSchema,
} from '@deployer/contracts-common';
import { projects } from "@deployer/nest-schema/global/project/deployment";
import { zodEnumToPgEnumValues } from "@deployer/nest-schema/global/utils/zod-enum";

import { encryptedText } from '../../codecs/codec-registry';

export const cacheStrategyEnum = pgEnum('cache_strategy', [...zodEnumToPgEnumValues(cacheStrategySchema)]);
