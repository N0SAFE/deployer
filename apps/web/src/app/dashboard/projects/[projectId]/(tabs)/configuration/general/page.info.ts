import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsConfigurationGeneral",
  params: z.object({
    projectId: z.string(),
  })
};

