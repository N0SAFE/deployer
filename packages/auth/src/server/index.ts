// Export the auth factory
export { betterAuthFactory } from "./auth";

// Server-side account creation for trusted paths (sign-up is disabled)
export { provisionUserAccount } from "./provision-user";
export type { ProvisionUserInput } from "./provision-user";

// Export the origin derivation shared by Better Auth and the API's CORS gateway
export { buildTrustedOrigins } from "./origins";
export type { TrustedOriginsEnv } from "./origins";

// Constant-time secret comparison, for every bearer/static-token check
export { bearerToken, secretsMatch } from "./secrets";

// Export server plugins
export * from "./plugins/index";
export { actionHash } from "./action-hash";
