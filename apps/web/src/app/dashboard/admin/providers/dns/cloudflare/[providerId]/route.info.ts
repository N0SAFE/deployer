import { z } from "zod";

export const page = true;
export const layout = false;
export const Route = {
  name: "AuthDashboardAdminProvidersDnsCloudflareProviderId",
  params: z.object({
    providerId: z.string(),
  }),
};
