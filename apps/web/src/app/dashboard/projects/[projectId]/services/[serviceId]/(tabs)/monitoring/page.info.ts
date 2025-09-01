import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsMonitoring",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

