import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabs",
  params: z.object({
    projectId: z.string(),
  })
};

