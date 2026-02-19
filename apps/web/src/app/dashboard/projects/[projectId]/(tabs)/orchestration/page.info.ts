import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsOrchestration",
  params: z.object({
    projectId: z.string(),
  })
};

