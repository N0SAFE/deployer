import { z } from "zod";

export const page = true;
export const layout = true;
export const Route = {
  name: "AuthDashboardNetwork",
  params: z.object({}),
};
