import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

export const subscriptionSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});

export const getSubscriptionsOutputSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
});

const pushSubscriptionOps = standard.zod(subscriptionSchema, "pushSubscription");

export const getSubscriptionsContract = pushSubscriptionOps
  .list()
  .path("/subscriptions")
  .input(z.object({}))
  .output(getSubscriptionsOutputSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
