// Export types
export type { IEnvService, Session, Auth, User, InferSessionFromAuth } from "@repo/auth/types";

// Export permissions at root level
export * from "@repo/auth/permissions/index";

// Note: Server and client exports are available via their respective subpaths:
// - @repo/auth/server
// - @repo/auth/client
// - @repo/auth/permissions
