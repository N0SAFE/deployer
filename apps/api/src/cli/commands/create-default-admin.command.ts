import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { EnvService } from '@/config/env/env.service';
import { apiEnvSchema } from '@repo/env';
import zod from 'zod/v4';
import { CLI_AUTH_SERVICE_TOKEN, ENV_SERVICE } from '../tokens';
import { CliAuthService } from '../services/cli-auth.service';

// Extend the API schema with command-specific environment variables
const createDefaultAdminEnvSchema = apiEnvSchema.safeExtend({
  DEFAULT_ADMIN_EMAIL: zod.email().min(1, 'DEFAULT_ADMIN_EMAIL is required'),
  DEFAULT_ADMIN_PASSWORD: zod.string().min(1, 'DEFAULT_ADMIN_PASSWORD is required'),
});

type CreateDefaultAdminEnv = zod.infer<typeof createDefaultAdminEnvSchema>;

@Command({
  name: 'create-default-admin',
  description: 'Create a default admin user if it does not exist',
})
@Injectable()
export class CreateDefaultAdminCommand extends CommandRunner {
  private readonly commandEnvService: EnvService<CreateDefaultAdminEnv>;
  
  constructor(
    private readonly cliAuthService: CliAuthService,
    private readonly envService: EnvService,
  ) {
    super();
    this.commandEnvService = this.envService.use(createDefaultAdminEnvSchema);
  }

  async run(): Promise<void> {
    console.log('🔐 Checking for default admin user...');

    try {
      // Validate required env vars through typed schema access
      this.commandEnvService.get('DEFAULT_ADMIN_EMAIL');
      this.commandEnvService.get('DEFAULT_ADMIN_PASSWORD');

      const password = await this.cliAuthService.ensureDefaultAdminUser();

      if (password === null) {
        console.error('❌ Failed to ensure default admin user');
        process.exit(1);
      }

      console.log('✅ Default admin user is configured and ready');
    } catch (error) {
      console.error('❌ Failed to create admin user:', error);
      throw error;
    }
  }
}
