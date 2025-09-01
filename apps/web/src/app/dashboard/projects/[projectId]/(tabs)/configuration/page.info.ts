import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsConfiguration",
  params: z.object({
    projectId: z.string(),
  })
};

