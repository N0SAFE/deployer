import z from "zod/v4";

export const projectIdParamSchema = z.object({ id: z.uuid() });
