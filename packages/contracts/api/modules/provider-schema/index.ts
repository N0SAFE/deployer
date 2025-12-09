/**
 * Provider Schema Contract - Dynamic Configuration Management
 * 
 * **PURPOSE**: Expose provider and builder configuration schemas for dynamic form generation
 * 
 * **SCOPE**: This contract handles:
 * - Provider and builder metadata retrieval
 * - Configuration schema exposure for dynamic forms
 * - Compatibility checking between providers and builders
 * - Configuration validation
 * 
 * **FRONTEND INTEGRATION**: ✅ Dynamic form generation
 * - Render provider configuration forms based on schema
 * - Render builder configuration forms based on schema
 * - Show compatible builders for selected provider
 * - Show compatible providers for selected builder
 * - Real-time configuration validation
 * 
 * Routes: /providers/*, /builders/*
 * Status: 🟢 Production Ready
 */

import { oc } from '@orpc/contract';
import {
  getAllProvidersContract,
  getProviderSchemaContract,
  getCompatibleBuildersContract,
  getAllBuildersContract,
  getBuilderSchemaContract,
  getCompatibleProvidersContract,
  validateProviderConfigContract,
  validateBuilderConfigContract,
} from './contracts';

export const providerSchemaRouter = oc.router({
  getAllProviders: getAllProvidersContract,
  getProviderSchema: getProviderSchemaContract,
  getCompatibleBuilders: getCompatibleBuildersContract,
  getAllBuilders: getAllBuildersContract,
  getBuilderSchema: getBuilderSchemaContract,
  getCompatibleProviders: getCompatibleProvidersContract,
  validateProviderConfig: validateProviderConfigContract,
  validateBuilderConfig: validateBuilderConfigContract,
});

// Export schemas for use in other modules
export * from './schemas';
export * from './contracts';
