import { z } from "zod";

export const page = true;
export const layout = false;
export const Route = {
  name: "AuthDashboardSettingsAudit",
  params: z.object({}),
};
