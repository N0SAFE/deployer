import z from 'zod/v4'

/**
 * A platform user, as the API returns one.
 *
 * `role` is a NAME, not an enum: roles are rows now (`roles` table, `SEC-055`), so a deployment can create one and the
 * entity schema cannot be the place that forbids it. What a role GRANTS is a separate question, answered by the
 * catalogue (`roleHasPermission`), never by this shape.
 */
export const userSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    role: z.string().min(1).optional(),
    banned: z.boolean().optional(),
})
export type User = z.infer<typeof userSchema>
