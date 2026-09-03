import z from 'zod/v4';
import { BaseTriggerService } from '@/core/modules/triggers/base-bridge.service';

export const configTriggerSchema = z.object({
  valid: z.literal(true),
});

export type ConfigTriggerPayload = z.infer<typeof configTriggerSchema>;

export class ConfigTriggerService extends BaseTriggerService<typeof configTriggerSchema> {
  constructor() {
    super(configTriggerSchema);
  }
}

export const configTrigger = new ConfigTriggerService();
