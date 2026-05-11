import { oc } from "@orpc/contract";
import { dockerImageSecurityScanStreamContract } from "../../../security/scanning/images/stream";

export const dockerImageSecurityScanningContract = oc
  .tag("Docker Image Security Scanning")
  .prefix("/scanning")
  .router({
    stream: dockerImageSecurityScanStreamContract,
  });

export { dockerImageSecurityScanStreamContract };
