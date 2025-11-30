/**
 * Re-export all context types for backward compatibility
 * 
 * This file exists to support imports from 'service-context.types'
 * All types are defined in index.ts
 */
export type {
  ServiceDomainMapping,
  ServiceContext,
  ProjectContext,
} from './index';

export {
  ServiceContextBuilder,
  ProjectContextBuilder,
  ContextUtils,
} from './index';
