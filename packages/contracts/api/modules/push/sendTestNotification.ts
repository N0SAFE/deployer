import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

export const sendTestNotificationOutputSchema = z.object({
  success: z.number(),
  failed: z.number(),
  total: z.number(),
});

const pushSendTestNotificationOps = standard.zod(
  sendTestNotificationOutputSchema,
  "pushSendTestNotification",
);

export const sendTestNotificationContract = pushSendTestNotificationOps
  .create()
  .path("/test")
  .input(z.object({}))
  .output(sendTestNotificationOutputSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
