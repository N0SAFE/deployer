import { createServe } from "@deployer/effect-orpc";

/** The identity service's request boundary; see `createServe`. */
export const { serve, serveAnonymous } = createServe({ service: "svc-identity" });
