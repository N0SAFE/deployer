import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

export const unsubscribeInputSchema = z.object({
  endpoint: z.string(),
});

export const unsubscribeOutputSchema = z.object({
  success: z.boolean(),
});

const pushUnsubscribeOps = standard.zod(unsubscribeOutputSchema, "pushUnsubscribe");

export const unsubscribeContract = pushUnsubscribeOps
  .create()
  .path("/unsubscribe")
  .input((b) => b.body(unsubscribeInputSchema))
  .output(unsubscribeOutputSchema)
  .errors((e) => [
    // 404 for unknown push subscription endpoint.
    ...standardDomainErrorContracts(e),
  ])
  .build();
