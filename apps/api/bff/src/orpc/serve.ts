import { createServe } from "@deployer/effect-orpc";

/** The BFF's request boundary; see `createServe`. */
export const { serve, serveAnonymous } = createServe({ service: "api-bff" });
