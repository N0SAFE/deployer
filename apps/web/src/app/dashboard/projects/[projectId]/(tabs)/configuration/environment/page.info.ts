import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsConfigurationEnvironment",
  params: z.object({
    projectId: z.string(),
  })
};

