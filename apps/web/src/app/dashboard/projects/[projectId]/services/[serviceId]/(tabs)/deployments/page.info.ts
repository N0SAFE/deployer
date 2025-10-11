import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsDeployments",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

