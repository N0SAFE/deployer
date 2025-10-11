/**
 * API Contract Modules - Export Index
 *
 * **Domain-Driven Contract Organization** for the Universal Deployment Platform.
 * Each module handles a specific aspect of platform functionality with clear
 * boundaries and well-defined responsibilities.
 *
 * **Contract Maturity Levels**:
 * - 🟢 Production Ready: Feature-complete, actively used, stable
 * - 🟡 Partially Used: Some features active, others available but not used
 * - 🔴 Deprecated: Implemented but should be removed
 *
 * **Frontend Integration Status**:
 * - ✅ Active: Used by React components and hooks
 * - ❌ Backend Only: Internal usage only, not exposed to frontend
 *
 * @see ../CONTRACT_ARCHITECTURE.md for detailed documentation
 * @see ../CONTRACT_OVERVIEW.md for comprehensive contract guide
 * @see ../QUICK_REFERENCE.md for developer quick start
 */
// =============================================================================
// 🔑 CORE FOUNDATION - Essential platform functionality
// =============================================================================
/** System health monitoring and status checks - Backend monitoring only */
export * from './health'; // 🟢 Routes: /health/* | Frontend: ❌ | Complexity: Low
/** User management and authentication - Core platform security */
export * from './user'; // 🟢 Routes: /user/* | Frontend: ✅ | Complexity: Medium
/** Initial application setup - First-time configuration */
export * from './setup'; // 🟢 Routes: /setup/* | Frontend: ✅ | Complexity: Low

// =============================================================================
// 🏢 PROJECT MANAGEMENT - Core business logic
// =============================================================================

/** Project lifecycle and team management - Primary frontend functionality */
export * from './project'; // 🟢 Routes: /projects/* | Frontend: ✅ | Complexity: High

/** Service definitions and monitoring - Service configuration and tracking */
export * from './service'; // 🟢 Routes: /services/* | Frontend: ✅ | Complexity: Medium-High

/** Environment and variable management - Configuration and preview environments */
export * from './environment'; // 🟢 Routes: /environments/* | Frontend: ✅ | Complexity: High

/** Multi-level domain management - Organization, project, and service domain hierarchy */
export * from './domain'; // 🟢 Routes: /domains/* | Frontend: ✅ | Complexity: High
// =============================================================================
// 🏢 PROJECT MANAGEMENT - Core business logic
// =============================================================================
/** Project lifecycle and team management - Primary frontend functionality */
export * from './project'; // 🟢 Routes: /projects/* | Frontend: ✅ | Complexity: High
/** Service definitions and monitoring - Service configuration and tracking */
export * from './service'; // 🟢 Routes: /services/* | Frontend: ✅ | Complexity: Medium-High
/** Environment and variable management - Configuration and preview environments */
export * from './environment'; // 🟢 Routes: /environments/* | Frontend: ✅ | Complexity: High
// =============================================================================
// 🚀 DEPLOYMENT OPERATIONS - Application deployment workflows  
// =============================================================================
/** PRIMARY deployment operations - Simple, focused deployment functionality */
export * from './deployment'; // 🟢 Routes: /deployment/* | Frontend: ✅ PRIMARY | Complexity: Medium
/** Advanced CI/CD pipelines - Complex automation workflows */
export * from './ci-cd'; // 🟡 Routes: /ci-cd/* | Frontend: ❌ | Complexity: High
// =============================================================================
// 🏗️ INFRASTRUCTURE - Platform infrastructure management
// =============================================================================
/** Load balancer and routing configuration - Automatic traffic management */
export * from './traefik'; // 🟢 Routes: /traefik/* | Frontend: ❌ | Complexity: Medium
/** Container orchestration and scaling - Runtime container management */
export * from './orchestration'; // 🟢 Routes: /orchestration/* | Frontend: ❌ | Complexity: Medium
/** File and artifact storage management - Upload and download operations */
export * from './storage'; // 🟢 Routes: /storage/* | Frontend: ❌ | Complexity: Low
/** Static file deployment with nginx containers - Lightweight static hosting */
export * from './static-file'; // 🟢 Routes: /static-file/* | Frontend: ❌ | Complexity: Medium
// =============================================================================
// 📊 MONITORING & ANALYTICS - Observability and insights
// =============================================================================
/** Usage analytics and performance metrics - Platform usage insights */
export * from './analytics'; // 🟢 Routes: /analytics/* | Frontend: ❌ | Complexity: Medium
/** Dynamic configuration resolution - Template and variable processing */
export * from './variable-resolver'; // 🟢 Routes: /variable-resolver/* | Frontend: ❌ | Complexity: Medium

// =============================================================================
// ⚙️ CONFIGURATION - Dynamic schema-driven configuration
// =============================================================================

/** Provider and builder schema management - Dynamic form generation */
export * from './provider-schema'; // 🟢 Routes: /providers/*, /builders/* | Frontend: ✅ | Complexity: Medium
