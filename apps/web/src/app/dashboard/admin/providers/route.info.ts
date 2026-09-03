import { z } from "zod";

export const page = true;
export const layout = false;
export const Route = {
  name: "AuthDashboardAdminProviders",
  params: z.object({}),
};
