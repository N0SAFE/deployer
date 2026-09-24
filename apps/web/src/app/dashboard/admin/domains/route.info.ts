import { z } from "zod";

export const page = true;
export const layout = true;
export const Route = {
  name: "AuthDashboardAdminDomains",
  params: z.object({}),
};
