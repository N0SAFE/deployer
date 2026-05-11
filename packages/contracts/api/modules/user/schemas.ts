import z from "zod/v4";
import { PLATFORM_ROLES } from "@repo/auth/permissions";

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  role: z.enum(PLATFORM_ROLES).optional(),
  banned: z.boolean().optional(),
});
