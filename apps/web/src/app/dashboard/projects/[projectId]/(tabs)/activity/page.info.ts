import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsActivity",
  params: z.object({
    projectId: z.string(),
  })
};

