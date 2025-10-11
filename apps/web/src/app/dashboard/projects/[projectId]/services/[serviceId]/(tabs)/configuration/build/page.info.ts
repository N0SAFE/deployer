import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsConfigurationBuild",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

