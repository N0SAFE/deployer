import { oc } from "@orpc/contract";
import { z } from "zod";
import { TraefikConfigSchema, SuccessWithDataResponseSchema } from "./schemas";
export const generateTraefikPreviewContract = oc
    .route({
    method: "POST",
    path: "/traefik/preview",
    summary: "Generate Traefik configuration preview",
    description: "Generate a preview of Traefik configuration based on provided settings",
})
    .input(TraefikConfigSchema)
    .output(SuccessWithDataResponseSchema(z.any()));
