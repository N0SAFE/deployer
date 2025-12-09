import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  configSchemaSchema,
  providerMetadataSchema,
  builderMetadataSchema,
  providerConfigValidationResultSchema,
} from './schemas';

/**
 * Get all registered providers
 */
export const getAllProvidersContract = oc
  .route({
    method: 'GET',
    path: '/providers',
    summary: 'Get all registered providers',
  })
  .input(z.object({}))
  .output(z.object({
    providers: z.array(providerMetadataSchema),
    total: z.number(),
  }));

/**
 * Get provider configuration schema by ID
 */
export const getProviderSchemaContract = oc
  .route({
    method: 'GET',
    path: '/providers/:id/schema',
    summary: 'Get provider configuration schema',
  })
  .input(z.object({
    id: z.string(),
  }))
  .output(configSchemaSchema);

/**
 * Get compatible builders for a provider
 */
export const getCompatibleBuildersContract = oc
  .route({
    method: 'GET',
    path: '/providers/:providerId/builders',
    summary: 'Get compatible builders for a provider',
  })
  .input(z.object({
    providerId: z.string(),
  }))
  .output(z.object({
    builders: z.array(builderMetadataSchema),
    total: z.number(),
  }));

/**
 * Get all registered builders
 */
export const getAllBuildersContract = oc
  .route({
    method: 'GET',
    path: '/builders',
    summary: 'Get all registered builders',
  })
  .input(z.object({}))
  .output(z.object({
    builders: z.array(builderMetadataSchema),
    total: z.number(),
  }));

/**
 * Get builder configuration schema by ID
 */
export const getBuilderSchemaContract = oc
  .route({
    method: 'GET',
    path: '/builders/:id/schema',
    summary: 'Get builder configuration schema',
  })
  .input(z.object({
    id: z.string(),
  }))
  .output(configSchemaSchema);

/**
 * Get compatible providers for a builder
 */
export const getCompatibleProvidersContract = oc
  .route({
    method: 'GET',
    path: '/builders/:builderId/providers',
    summary: 'Get compatible providers for a builder',
  })
  .input(z.object({
    builderId: z.string(),
  }))
  .output(z.object({
    providers: z.array(providerMetadataSchema),
    total: z.number(),
  }));

/**
 * Validate provider configuration
 */
export const validateProviderConfigContract = oc
  .route({
    method: 'POST',
    path: '/providers/:providerId/validate',
    summary: 'Validate provider configuration',
    description: 'Validate configuration values against provider schema',
  })
  .input(
    z.object({
      providerId: z.string(),
      config: z.any(),
    })
  )
  .output(providerConfigValidationResultSchema);

/**
 * Validate builder configuration
 */
export const validateBuilderConfigContract = oc
  .route({
    method: 'POST',
    path: '/builders/:builderId/validate',
    summary: 'Validate builder configuration',
  })
  .input(z.object({
    builderId: z.string(),
    config: z.any(),
  }))
  .output(providerConfigValidationResultSchema);
