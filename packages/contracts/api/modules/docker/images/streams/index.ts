import { oc } from "@orpc/contract";
import { dockerImageInspectStreamContract } from "../stream-inspect";

export const dockerImageStreamsContract = oc.tag("Docker Image Streams").router({
  inspect: dockerImageInspectStreamContract,
});

export { dockerImageInspectStreamContract };
