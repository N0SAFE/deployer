import { oc } from "@orpc/contract";
import { z } from "zod";
import { CertificateStatusSchema, SuccessWithDataResponseSchema } from "./schemas";

export const listCertificatesContract = oc
  .route({
    method: "GET",
    path: "/certificates",
    summary: "List SSL certificates",
    description: "Retrieve the list of SSL certificates for a project with their status",
  })
  .input(z.object({
    projectId: z.string(),
  }))
  .output(SuccessWithDataResponseSchema(z.array(CertificateStatusSchema)));