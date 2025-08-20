import { z } from "zod";

export const Route = {
  name: "DashboardProjectsId",
  params: z.object({
    id: z.string(),
  })
};

