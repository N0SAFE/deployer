import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsConfigurationEnvironment",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

