import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsServices",
  params: z.object({
    projectId: z.string(),
  })
};

