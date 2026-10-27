import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerImageSecurityScanStreamContract } from "../../../security/scanning/images/stream";

export const dockerImageSecurityScanningContract = oc.meta(openapi({ tags: ["Docker Image Security Scanning"], prefix: "/scanning" })).router({
    stream: dockerImageSecurityScanStreamContract,
  });

export { dockerImageSecurityScanStreamContract };
