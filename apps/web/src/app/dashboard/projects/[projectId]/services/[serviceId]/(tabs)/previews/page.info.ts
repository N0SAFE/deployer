import { z } from "zod";

export const Route = {
  name: "DashboardProjectsProjectIdServicesServiceIdTabsPreviews",
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  })
};

