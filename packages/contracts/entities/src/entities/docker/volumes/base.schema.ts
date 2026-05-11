import z from 'zod/v4'

export const dockerVolumeDriverSchema = z.enum(['local', 'nfs', 'csi', 'tmpfs', 'custom'])
export type DockerVolumeDriver = z.infer<typeof dockerVolumeDriverSchema>

export const dockerVolumeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  driver: dockerVolumeDriverSchema,
  mountpoint: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  usedByContainerIds: z.array(z.string().min(1)).default([]),
  labels: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerVolume = z.infer<typeof dockerVolumeSchema>