import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

