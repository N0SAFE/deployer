import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsLogs",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  }),
  // Allow navigating to this page with an optional deploymentId in the search params
  search: z.object({
    deploymentId: z.string().optional(),
  }),
};

