import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

