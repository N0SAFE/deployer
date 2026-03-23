import { z } from "zod";


// Auto-generated flags - DO NOT EDIT manually, these are synced by dr:build
export const page = true;
export const layout = false;
export const Route = {
  name: "AuthSignin",
  params: z.object({
    
  }),
  search: z.object({
    redirectTo: z.string().optional(),
    callbackUrl: z.string().optional()
  })
};

