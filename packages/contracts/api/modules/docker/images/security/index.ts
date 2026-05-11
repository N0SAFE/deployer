import { oc } from "@orpc/contract";
import { dockerImageSecurityScanningContract } from "./scanning";

export const dockerImageSecurityContract = oc
  .tag("Docker Image Security")
  .prefix("/security")
  .router({
  scanning: dockerImageSecurityScanningContract,
});

export { dockerImageSecurityScanningContract };
export * from "./scanning";
