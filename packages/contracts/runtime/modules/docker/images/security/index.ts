import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerImageSecurityScanningContract } from "./scanning";

export const dockerImageSecurityContract = oc.meta(openapi({ tags: ["Docker Image Security"], prefix: "/security" })).router({
  scanning: dockerImageSecurityScanningContract,
});

export { dockerImageSecurityScanningContract };
export * from "./scanning";
