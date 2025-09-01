import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsConfigurationEnvironmentsEnvironmentId",
  params: z.object({
    projectId: z.string(),
    environmentId: z.string(),
  })
};

