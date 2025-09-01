import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsMonitoring",
  params: z.object({
    projectId: z.string(),
  })
};

