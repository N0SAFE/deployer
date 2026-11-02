import { relations } from 'drizzle-orm';
import {
  
  
  
  
  
  
  
  pgEnum,
  
  
} from 'drizzle-orm/pg-core';


import {
  cacheStrategySchema,
  
  
} from '@deployer/contracts-common';
import { projects } from "@deployer/nest-schema/global/project/deployment";
import { zodEnumToPgEnumValues } from "@deployer/nest-schema/global/utils/zod-enum";

import { encryptedText } from '../../codecs/codec-registry';

export const cacheStrategyEnum = pgEnum('cache_strategy', [...zodEnumToPgEnumValues(cacheStrategySchema)]);
