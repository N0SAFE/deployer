/**
 * Environment Contract - Environment Management and Variable Resolution
 *
 * **PURPOSE**: Comprehensive environment lifecycle management with advanced variable processing
 *
 * **SCOPE**: This contract provides sophisticated environment functionality including:
 * - Environment CRUD operations with validation and comparison
 * - Advanced variable management with templating and resolution
 * - Preview environment creation and cleanup automation
 * - Dynamic variable resolution with dependency tracking
 * - Template processing with advanced interpolation
 * - Environment validation and status monitoring
 *
 * **FRONTEND INTEGRATION**: ✅ Environment management - Used by settings and deployment pages
 * - Environment configuration forms and variable editors
 * - Preview environment management interfaces
 * - Variable template system for dynamic configuration
 * - Environment comparison and validation tools
 *
 * **CONTRACT ORGANIZATION**:
 * - **Basic CRUD**: Environment lifecycle operations (list, get, create, update, delete)
 * - **Variable Management**: Variable CRUD with bulk operations and resolution
 * - **Preview Environments**: Temporary environment creation and automated cleanup
 * - **Variable Resolution**: Template parsing and dynamic variable interpolation
 * - **Utilities**: Validation, comparison, and status management
 *
 * **ADVANCED FEATURES**:
 * - **Template Resolution**: Dynamic variable interpolation with nested references
 * - **Preview Environments**: Auto-expiring environments for testing
 * - **Bulk Operations**: Efficient multi-environment management
 * - **Resolution History**: Track variable resolution over time
 * - **Environment Comparison**: Diff between environment configurations
 *
 * **RELATIONSHIP TO OTHER CONTRACTS**:
 * - **`project`**: Environments belong to projects and can be managed through project contract
 * - **`service`**: Services inherit environment variables during deployment
 * - **`deployment`**: Deployments target specific environments
 * - **`variable-resolver`**: Uses advanced resolution for complex variable processing
 *
 * Routes: /environments/*
 * Status: 🟢 Production Ready - Feature-complete with advanced capabilities
 * Frontend Usage: ✅ Environment management and configuration interfaces
 * Complexity: High - Advanced variable resolution and preview environment automation
 *
 * @example
 * // Create new environment with variables
 * const environment = await orpc.environment.create({
 *   projectId: "proj_123",
 *   name: "staging",
 *   type: "staging",
 *   variables: {
 *     API_URL: "https://api-staging.example.com",
 *     DATABASE_URL: "${DATABASE_HOST}:5432/${DATABASE_NAME}"
 *   }
 * });
 *
 * // Resolve variables with templating
 * const resolved = await orpc.environment.resolveVariables({
 *   environmentId: environment.id,
 *   variables: { DATABASE_HOST: "db-staging.example.com", DATABASE_NAME: "myapp_staging" }
 * });
 *
 * // Create preview environment for feature branch
 * const preview = await orpc.environment.createPreview({
 *   sourceEnvironmentId: environment.id,
 *   name: "feature-branch-123",
 *   ttlHours: 24, // Auto-cleanup after 24 hours
 *   overrideVariables: { API_URL: "https://api-preview-123.example.com" }
 * });
 *
 * // Compare environments
 * const diff = await orpc.environment.compare({
 *   sourceId: "staging_env_id",
 *   targetId: "production_env_id"
 * });
 *
 * @see ../../CONTRACT_ARCHITECTURE.md for detailed contract organization
 * @see ../project/environments.ts for project-level environment operations
 * @see ../variable-resolver/index.ts for advanced variable processing
 */
import { oc } from '@orpc/contract';
// Import all contract definitions
import { environmentListContract } from './list';
import { environmentGetContract } from './get';
import { environmentCreateContract } from './create';
import { environmentUpdateContract } from './update';
import { environmentDeleteContract } from './delete';
import { environmentGetVariablesContract, environmentUpdateVariablesContract, environmentResolveVariablesContract, environmentBulkUpdateVariablesContract, } from './variables';
import { environmentCreatePreviewContract, environmentCreatePreviewForProjectContract, environmentListPreviewsContract, environmentListPreviewEnvironmentsContract, environmentCleanupExpiredPreviewsContract, environmentCleanupPreviewEnvironmentsContract, } from './preview';
import { environmentParseTemplateContract, environmentResolveTemplateContract, environmentBatchResolveTemplatesContract, environmentResolveEnvironmentVariablesContract, environmentResolveVariablesAdvancedContract, environmentGetResolutionHistoryContract, } from './resolution';
import { environmentUpdateStatusContract, environmentValidateContract, environmentCompareContract, environmentBulkDeleteContract, } from './utils';
// Combine into main environment contract
export const environmentContract = oc.tag("Environment").prefix("/environments").router({
    // Basic CRUD
    list: environmentListContract,
    get: environmentGetContract,
    create: environmentCreateContract,
    update: environmentUpdateContract,
    delete: environmentDeleteContract,
    // Variable management
    getVariables: environmentGetVariablesContract,
    updateVariables: environmentUpdateVariablesContract,
    resolveVariables: environmentResolveVariablesContract,
    bulkUpdateVariables: environmentBulkUpdateVariablesContract,
    // Preview environments
    createPreview: environmentCreatePreviewContract,
    createPreviewForProject: environmentCreatePreviewForProjectContract,
    listPreviews: environmentListPreviewsContract,
    listPreviewEnvironments: environmentListPreviewEnvironmentsContract,
    cleanupExpiredPreviews: environmentCleanupExpiredPreviewsContract,
    cleanupPreviewEnvironments: environmentCleanupPreviewEnvironmentsContract,
    // Variable resolution
    parseTemplate: environmentParseTemplateContract,
    resolveTemplate: environmentResolveTemplateContract,
    batchResolveTemplates: environmentBatchResolveTemplatesContract,
    resolveEnvironmentVariables: environmentResolveEnvironmentVariablesContract,
    resolveVariablesAdvanced: environmentResolveVariablesAdvancedContract,
    getResolutionHistory: environmentGetResolutionHistoryContract,
    // Utilities and validation
    updateStatus: environmentUpdateStatusContract,
    validate: environmentValidateContract,
    compare: environmentCompareContract,
    bulkDelete: environmentBulkDeleteContract,
});
export type EnvironmentContract = typeof environmentContract;
// Re-export everything from individual contracts
export * from './schemas';
export * from './list';
export * from './get';
export * from './create';
export * from './update';
export * from './delete';
export * from './variables';
export * from './preview';
export * from './resolution';
export * from './utils';
