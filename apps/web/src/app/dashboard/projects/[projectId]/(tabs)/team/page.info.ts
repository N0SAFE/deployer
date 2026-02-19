import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsTeam",
  params: z.object({
    projectId: z.string(),
  })
};

