/**
 * Public surface of the contract package.
 *
 * Every module contract is exported individually. The combined app router used
 * to be exported here as `appContract`, but a single router combining 21
 * modules produces an inferred type larger than TypeScript's declaration
 * serialization limit (TS7056), which made declaration emit of this package
 * impossible — and forced every consumer to type-check the whole contract
 * source tree.
 *
 * Consumers that need the full surface (server handler, OpenAPI generation,
 * typed clients) compose it locally:
 *
 *     import { oc } from "@orpc/contract";
 *     import { userContract, ... } from "@repo/api-contracts";
 *
 *     export const appContract = oc.router({ user: userContract, ... });
 *
 * They all run with `declaration: false`, where the composed type is never
 * serialized, so the limit does not apply. This is the fix ORPC documents for
 * "exceeds the maximum length".
 */

export * from "./modules/index";
export * from "./types";
