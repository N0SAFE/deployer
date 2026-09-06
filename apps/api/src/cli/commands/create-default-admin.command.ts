import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@/config/env/env.service';
import { apiEnvSchema } from '@repo/env';
import zod from 'zod/v4';
import { CliAuthService } from '../services/cli-auth.service';

// Extend the API schema with command-specific environment variables. Both
// mirror the base schema's optionality — the boot path never requires them,
// so the CLI must not fail env validation when they're absent:
//   - DEFAULT_ADMIN_EMAIL absent   → graceful skip (nothing to create)
//   - DEFAULT_ADMIN_PASSWORD absent → the service generates + logs one
const createDefaultAdminEnvSchema = apiEnvSchema.safeExtend({
  DEFAULT_ADMIN_EMAIL: zod.email().optional(),
  DEFAULT_ADMIN_PASSWORD: zod.string().optional(),
});

type CreateDefaultAdminEnv = zod.infer<typeof createDefaultAdminEnvSchema>;

@Command({
  name: 'create-default-admin',
  description: 'Create a default admin user if it does not exist',
})
@Injectable()
export class CreateDefaultAdminCommand extends CommandRunner {
  private readonly logger = new Logger(CreateDefaultAdminCommand.name);
  private readonly commandEnvService: EnvService<CreateDefaultAdminEnv>;
  
  constructor(
    private readonly cliAuthService: CliAuthService,
    private readonly envService: EnvService,
  ) {
    super();
    this.commandEnvService = this.envService.use(createDefaultAdminEnvSchema);
  }

  async run(): Promise<void> {
    this.logger.log('🔐 Checking for default admin user...');

    try {
      // No email configured → nothing to create (same graceful skip as the
      // boot path). Never fail validation / hard-exit for an absent email.
      const email = this.commandEnvService.get('DEFAULT_ADMIN_EMAIL');
      if (!email) {
        this.logger.log('ℹ️  DEFAULT_ADMIN_EMAIL not configured — skipping default admin creation');
        return;
      }

      const password = await this.cliAuthService.ensureDefaultAdminUser();

      if (password === null) {
        this.logger.error('❌ Failed to ensure default admin user');
        process.exit(1);
      }

      this.logger.log('✅ Default admin user is configured and ready');
    } catch (error) {
      this.logger.error('❌ Failed to create admin user:', error);
      throw error;
    }
  }
}
