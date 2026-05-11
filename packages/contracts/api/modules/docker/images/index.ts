import { oc } from "@orpc/contract";
import { dockerListImagesContract } from "./list";
import { dockerImageInspectContract } from "./inspect";
import { dockerImageStreamsContract } from "./streams";
import { dockerImageSecurityContract } from "./security";

export const dockerImagesContract = oc.tag("Docker Images").prefix("/images").router({
	list: dockerListImagesContract,
	inspect: dockerImageInspectContract,
	streams: dockerImageStreamsContract,
	security: dockerImageSecurityContract,
});

export * from "./list";
export * from "./inspect";
export * from "./stream-inspect";
export * from "./streams";
export * from "./security";
