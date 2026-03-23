import { z } from "zod";

export const page = true;
export const layout = false;
export const Route = {
  name: "Setup",
  params: z.object({}),
  search: z.object({
    redirectTo: z.string().optional(),
    callbackUrl: z.string().optional(),
    meshSetupReturn: z.string().optional(),
    meshServer: z.string().optional(),
  }),
};
