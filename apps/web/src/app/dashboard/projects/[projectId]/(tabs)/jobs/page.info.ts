import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsJobs",
  params: z.object({
    projectId: z.string(),
  })
};