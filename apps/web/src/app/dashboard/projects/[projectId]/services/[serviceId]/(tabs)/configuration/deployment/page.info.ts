import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsConfigurationDeployment",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

