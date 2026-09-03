import zod from 'zod/v4'

// Keep in sync with signup/schema.ts and Better Auth's default
// `minPasswordLength` (8) so client-side validation never diverges from what
// the auth server actually accepts.
export const loginSchema = zod.object({
    email: zod.email('Please enter a valid email address'),
    password: zod.string().min(8, 'Password must be at least 8 characters'),
})
