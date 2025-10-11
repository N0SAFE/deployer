import { oc } from "@orpc/contract";
import { z } from "zod";
import { CertificateStatusSchema, SuccessWithDataResponseSchema } from "./schemas";
export const getCertificateStatusContract = oc
    .route({
    method: "GET",
    path: "/certificates/{domain}",
    summary: "Get SSL certificate status",
    description: "Retrieve the status and details of an SSL certificate for a domain",
})
    .input(z.object({
    domain: z.string(),
}))
    .output(SuccessWithDataResponseSchema(CertificateStatusSchema));
