// Export the auth factory
export { betterAuthFactory } from "@deployer/auth/server/auth";

// Server-side account creation for trusted paths (sign-up is disabled)
export { provisionUserAccount } from "@deployer/auth/server/provision-user";
export type { ProvisionUserInput } from "@deployer/auth/server/provision-user";

// Export the origin derivation shared by Better Auth and the API's CORS gateway
export { buildTrustedOrigins } from "@deployer/auth/server/origins";
export type { TrustedOriginsEnv } from "@deployer/auth/server/origins";

// Constant-time secret comparison, for every bearer/static-token check
export { bearerToken, secretsMatch } from "@deployer/auth/server/secrets";

// Export server plugins
export * from "@deployer/auth/server/plugins/index";
