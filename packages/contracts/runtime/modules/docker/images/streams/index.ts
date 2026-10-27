import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerImageInspectStreamContract } from "../stream-inspect";

export const dockerImageStreamsContract = oc.meta(openapi({ tags: ["Docker Image Streams"] })).router({
  inspect: dockerImageInspectStreamContract,
});

export { dockerImageInspectStreamContract };
