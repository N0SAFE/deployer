import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabs",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

