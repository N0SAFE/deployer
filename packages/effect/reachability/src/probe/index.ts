/**
 * Probing: "is something alive at this address, and is it what I expect?"
 *
 * No transport code lives here: timeouts, redirect limits, response size caps, DNS pinning and the
 * address policy all come from `@deployer/effect-infra`'s `SafeHttp`. This module only decides which
 * urls to ask and how to read the answer. The caller supplies the `EgressPolicy`, because what a
 * probe may reach is the app's rule, not this package's.
 */
export * from "./address-probe";
export * from "./peer-identity";
export * from "./peer-probe";
export * from "./types";
