import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsConfiguration",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

