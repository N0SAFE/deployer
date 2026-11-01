// Export the auth factory
export { betterAuthFactory } from "@deployer/auth/server/auth";

// Export the origin derivation shared by Better Auth and the API's CORS gateway
export { buildTrustedOrigins } from "@deployer/auth/server/origins";
export type { TrustedOriginsEnv } from "@deployer/auth/server/origins";

// Export server plugins
export * from "@deployer/auth/server/plugins/index";
