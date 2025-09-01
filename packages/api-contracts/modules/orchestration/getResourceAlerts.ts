import { oc } from "@orpc/contract";
import { z } from "zod";
import { ResourceAlertSchema, SuccessWithDataResponseSchema } from "./schemas";

export const getResourceAlertsContract = oc
  .route({
    method: "GET",
    path: "/resources/alerts",
    summary: "Get resource usage alerts",
    description: "Retrieve current resource usage alerts and warnings",
  })
  .input(z.void())
  .output(SuccessWithDataResponseSchema(z.array(ResourceAlertSchema)));