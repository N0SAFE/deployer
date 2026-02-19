import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsDeployments",
  params: z.object({
    projectId: z.string(),
  })
};

