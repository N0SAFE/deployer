import z from 'zod/v4'

export const dockerTerminalShellSchema = z.enum(['bash', 'sh', 'zsh', 'ash'])
export type DockerTerminalShell = z.infer<typeof dockerTerminalShellSchema>

export const dockerTerminalProfileSchema = z.object({
  shell: dockerTerminalShellSchema,
  user: z.string().min(1),
  workingDir: z.string().min(1),
  recommended: z.boolean(),
})
export type DockerTerminalProfile = z.infer<typeof dockerTerminalProfileSchema>