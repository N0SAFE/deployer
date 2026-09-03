import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

const subscriptionKeysSchema = z.object({
  p256dh: z.string(),
  auth: z.string(),
});

export const subscribeInputSchema = z.object({
  endpoint: z.string(),
  keys: subscriptionKeysSchema,
  deviceName: z.string().optional(),
  userAgent: z.string().optional(),
});

export const subscribeOutputSchema = z.object({
  id: z.string(),
  deviceName: z.string().nullable(),
  createdAt: z.date(),
});

const pushSubscribeOps = standard.zod(subscribeOutputSchema, "pushSubscribe");

export const subscribeContract = pushSubscribeOps
  .create()
  .path("/subscribe")
  .input((b) => b.body(subscribeInputSchema))
  .output(subscribeOutputSchema)
  .errors((e) => [
    // 400 malformed push endpoint/keys; 409 duplicate subscription.
    ...standardDomainErrorContracts(e),
  ])
  .build();
