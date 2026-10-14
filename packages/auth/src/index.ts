// Export types
export type { IEnvService, Session, Auth, User, InferSessionFromAuth } from "./types";

// Export permissions at root level. Self-import by package name, not relative
// path: a relative import is a second reach of `./permissions/index` and bun then
// hoists away that module's `export *` re-exports (types still resolve).
export * from "@deployer/auth/permissions";

// Note: Server and client exports are available via their respective subpaths:
// - @deployer/auth/server
// - @deployer/auth/client
// - @deployer/auth/permissions
