/**
 * Health Contract - System Health Monitoring
 *
 * **PURPOSE**: Comprehensive system health monitoring and status reporting
 *
 * **SCOPE**: This contract provides essential platform monitoring including:
 * - Basic health checks for API availability and responsiveness
 * - Detailed system diagnostics with dependency status checking
 * - Service health aggregation across all platform components
 * - Infrastructure readiness and liveness probe endpoints
 *
 * **FRONTEND INTEGRATION**: ❌ Backend monitoring only
 * - Not directly used by frontend components
 * - Consumed by monitoring systems and infrastructure tools
 * - May be used by future admin dashboard for system status
 *
 * **CONTRACT ORGANIZATION**:
 * - **check**: Simple health check for basic availability (readiness probe)
 * - **detailed**: Comprehensive system status with dependency checks (diagnostic probe)
 *
 * **RELATIONSHIP TO OTHER CONTRACTS**:
 * - **Independent**: Does not depend on other contracts (by design)
 * - **Referenced by**: All other contracts rely on healthy system state
 * - **Monitoring**: Provides health status for deployment decisions
 *
 * **USE CASES**:
 * - Load balancer health probes
 * - Container orchestration readiness checks
 * - CI/CD deployment health validation
 * - System monitoring and alerting
 * - Infrastructure automation decisions
 *
 * Routes: /health/*
 * Status: 🟢 Production Ready - Critical infrastructure component
 * Frontend Usage: ❌ Infrastructure and monitoring only
 * Complexity: Low - Simple but critical functionality
 *
 * @example
 * // Basic health check (used by load balancers)
 * const status = await orpc.health.check(); // Returns { status: "healthy" }
 *
 * // Detailed diagnostics (used by monitoring systems)
 * const details = await orpc.health.detailed();
 * // Returns: {
 * //   status: "healthy",
 * //   dependencies: { database: "healthy", redis: "healthy" },
 * //   uptime: 86400,
 * //   version: "1.0.0"
 * // }
 *
 * @see ../../CONTRACT_ARCHITECTURE.md for detailed contract organization
 * @see ../deployment/index.ts for deployment health validation usage
 */
import { oc } from "@orpc/contract";
// Import all contract definitions
import { healthCheckContract } from "./check";
import { healthDetailedContract } from "./detailed";
// Combine into main health contract
export const healthContract = oc.tag("Health").prefix("/health").router({
    check: healthCheckContract,
    detailed: healthDetailedContract,
});
export type HealthContract = typeof healthContract;
// Re-export everything from individual contracts
export * from './check';
export * from './detailed';
