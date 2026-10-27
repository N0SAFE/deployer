// Public surface of @deployer/bff-contracts.
//
// The BFF is the ONLY public HTTP surface: this package holds the procedures the
// BFF owns outright (setup, test, template). Every other surface is a service's
// own contract, composed in by the BFF — see apps/api/bff/src/orpc/app-contract.ts.
//
// WHY THIS IS NOT ONE PACKAGE WITH THE SERVICES
// A contract package is the boundary of a service. Keeping them together is what
// let a service import a contract it does not serve, and let the public surface
// drift from what any service actually implements.

export * from "./modules/setup";
export * from "./modules/template";
export * from "./modules/test";

// The BFF's screen contract: the composed, screen-shaped procedures the FRONT
// calls. Distinct from the three above, which are procedures the BFF implements
// itself (setup/test/template) rather than composing from services.
export * from "./modules/orchestration";

// NOTE: the SERVICE SURFACE is deliberately NOT exported from this package.
// A function returning a 315-procedure router has an inferred type that exceeds
// TypeScript's declaration serialization limit (TS7056), and this package emits
// declarations — so exporting it fails the build with
// `error TS7056: The inferred type of this node exceeds the maximum length`.
// The list therefore lives in each application (`apps/*/src/orpc/service-surface.ts`),
// where `declaration` is false and the type is never serialized. The two copies are
// kept identical by `scripts/check-service-surface-parity.py`.

// Convenience input/output aliases for the test surface.
export * from "./types";
