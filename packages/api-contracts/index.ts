import { oc } from "@orpc/contract";
import { 
// Core Foundation
userContract, healthContract, 
// Project Management  
deploymentContract, projectContract, serviceContract, environmentContract, 
// Infrastructure
traefikContract, orchestrationContract, storageContract, staticFileContract, 
// Monitoring & Analytics  
analyticsContract, variableResolverContract, 
// CI/CD Operations
ciCdContract,
// Configuration
providerSchemaRouter } from "./modules/index";
/**
 * Universal Deployment Platform - Main API Contract
 *
 * This contract combines all feature-specific contracts into a unified API surface.
 * Contract organization follows domain boundaries with clear separation of concerns.
 *
 * @see CONTRACT_ARCHITECTURE.md for detailed documentation
 */
export const appContract = oc.router({
    // =============================================================================
    // CORE FOUNDATION - Essential platform functionality
    // =============================================================================
    /** System health monitoring and status checks */
    health: healthContract,
    /** User management and authentication */
    user: userContract,
    // =============================================================================  
    // PROJECT MANAGEMENT - Project and service configuration
    // =============================================================================
    /** Project lifecycle management and settings */
    project: projectContract,
    /** Service definitions and configurations within projects */
    service: serviceContract,
    /** Environment management and variable configuration */
    environment: environmentContract,
    // =============================================================================
    // DEPLOYMENT OPERATIONS - Core deployment functionality  
    // =============================================================================
    /** Primary deployment operations - trigger, monitor, logs, rollback */
    deployment: deploymentContract,
    /** Advanced CI/CD pipeline automation - pipelines, builds, webhooks */
    ciCd: ciCdContract,
    // =============================================================================
    // INFRASTRUCTURE - Platform infrastructure management
    // =============================================================================
    /** Load balancer, domain management, and SSL configuration */
    traefik: traefikContract,
    /** Container orchestration and resource management */
    orchestration: orchestrationContract,
    /** File storage, artifacts, and backup management */
    storage: storageContract,
    /** Static file deployment with lightweight nginx containers */
    staticFile: staticFileContract,
    // =============================================================================
    // MONITORING & ANALYTICS - Insights and configuration
    // =============================================================================
    /** Platform usage analytics and performance metrics */
    analytics: analyticsContract,
    /** Dynamic configuration and variable resolution */
    variableResolver: variableResolverContract,
    
    // =============================================================================
    // CONFIGURATION - Schema-driven configuration
    // =============================================================================
    
    /** Provider and builder schema management for dynamic forms */
    providerSchema: providerSchemaRouter,
});
export type AppContract = typeof appContract;
// Re-export individual contracts and schemas for direct access
export * from "./modules/index";
