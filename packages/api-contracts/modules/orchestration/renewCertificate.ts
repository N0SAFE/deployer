import { oc } from "@orpc/contract";
import { z } from "zod";
import { SuccessResponseSchema } from "./schemas";

export const renewCertificateContract = oc
  .route({
    method: "POST",
    path: "/certificates/{domain}/renew",
    summary: "Renew SSL certificate",
    description: "Initiate the renewal process for an SSL certificate",
  })
  .input(z.object({
    domain: z.string(),
  }))
  .output(SuccessResponseSchema);