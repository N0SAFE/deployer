import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsConfigurationResources",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

