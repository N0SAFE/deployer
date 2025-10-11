import { Controller, Logger } from '@nestjs/common';
import { setupContract } from '@repo/api-contracts';
import { SetupService } from '../services/setup.service';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { organization, member } from '@/config/drizzle/schema';
import { nanoid } from 'nanoid';
import { roles } from '@/config/auth/permissions/statements';
import { implement, Implement } from '@orpc/nest';
import { Public } from '@/core/modules/auth/decorators/decorators';
import { AuthService } from '@/core/modules/auth/services/auth.service';

@Controller()
export class SetupController {
  private readonly logger = new Logger(SetupController.name);

  constructor(
    private readonly setupService: SetupService,
    private readonly authService: AuthService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Check if initial setup is required
   */
  @Public()
  @Implement(setupContract.checkSetupStatus)
  checkSetupStatus() {
    return implement(setupContract.checkSetupStatus).handler(async () => {
      this.logger.log('Checking setup status');
      return this.setupService.checkSetupStatus();
    });
  }

  /**
   * Create initial user and organization
   * Only works when no users exist
   */
    @Public()
  @Implement(setupContract.createInitialUser)
  createInitialUser() {
    return implement(setupContract.createInitialUser).handler(async ({ input }) => {
      this.logger.log(`Creating initial user: ${input.email}`);
      
      // Verify setup is still needed (prevent race conditions)
      const needsSetup = await this.setupService.verifySetupNeeded();
      if (!needsSetup) {
        throw new Error('Setup has already been completed. Users already exist in the system.');
      }

      // Create the user with superAdmin role
      this.logger.log('Creating user with superAdmin role');
      const userResult = await this.authService.api.createUser({
        body: {
          name: input.name,
          email: input.email,
          password: input.password,
          data: {
            role: roles.superAdmin,
            emailVerified: true,
          },
        },
      });

      const createdUser = userResult.user;
      this.logger.log(`User created with id: ${createdUser.id}`);

      // Create organization
      const orgName = input.organizationName || 'Default Organization';
      this.logger.log(`Creating organization: ${orgName}`);
      const [createdOrg] = await this.database.db
        .insert(organization)
        .values({
          id: nanoid(),
          name: orgName,
          slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          createdAt: new Date(),
          metadata: JSON.stringify({
            createdBy: createdUser.id,
            isDefault: true,
            setupVersion: '1.0',
          }),
        })
        .returning();

      this.logger.log(`Organization created with id: ${createdOrg.id}`);

      // Add user as owner member
      this.logger.log(`Adding user as organization owner`);
      await this.database.db
        .insert(member)
        .values({
          id: nanoid(),
          organizationId: createdOrg.id,
          userId: createdUser.id,
          role: 'owner',
          createdAt: new Date(),
        });

      this.logger.log('Initial setup completed successfully');
      
      // Return user data without session - frontend will handle login
      return {
        user: {
          id: createdUser.id,
          name: createdUser.name,
          email: createdUser.email,
          role: 'superAdmin',
        },
        organization: {
          id: createdOrg.id,
          name: createdOrg.name,
          slug: createdOrg.slug || '',
        },
        session: {
          token: '', // Frontend should sign in to get actual session
          expiresAt: new Date().toISOString(),
        },
      };
    });
  }
}
