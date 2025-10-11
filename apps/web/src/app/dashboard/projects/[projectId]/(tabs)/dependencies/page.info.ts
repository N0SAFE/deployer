import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsDependencies",
  params: z.object({
    projectId: z.string(),
  })
};

