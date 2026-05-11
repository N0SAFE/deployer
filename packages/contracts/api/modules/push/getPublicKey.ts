import z from "zod/v4";
import { standard } from "@repo/orpc-utils";

export const getPublicKeyOutputSchema = z.object({
  publicKey: z.string(),
});

const pushPublicKeyOps = standard.zod(getPublicKeyOutputSchema, "pushPublicKey");

export const getPublicKeyContract = pushPublicKeyOps
  .list()
  .path("/public-key")
  .input(z.object({}))
  .output(getPublicKeyOutputSchema)
  .build();
