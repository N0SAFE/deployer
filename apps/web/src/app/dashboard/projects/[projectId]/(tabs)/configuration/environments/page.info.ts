import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsConfigurationEnvironments",
  params: z.object({
    projectId: z.string(),
  })
};

