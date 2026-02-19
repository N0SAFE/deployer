import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdTabsSsl",
  params: z.object({
    projectId: z.string(),
  })
};