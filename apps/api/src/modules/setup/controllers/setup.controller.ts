import { Controller, Logger } from '@nestjs/common';
import { setupContract } from '@repo/api-contracts';
import { SetupService } from '../services/setup.service';
import { SetupAdapter } from '../adapters/setup-adapter.service';
import { roles } from '@/config/auth/permissions/statements';
import { implement, Implement } from '@orpc/nest';
import { Public } from '@/core/modules/auth/decorators/decorators';
import { AuthService } from '@/core/modules/auth/services/auth.service';

@Controller()
export class SetupController {
  private readonly logger = new Logger(SetupController.name);

  constructor(
    private readonly setupService: SetupService,
    private readonly setupAdapter: SetupAdapter,
    private readonly authService: AuthService,
  ) {}

  /**
   * Check if initial setup is required
   */
  @Public()
  @Implement(setupContract.checkSetupStatus)
  checkSetupStatus() {
    return implement(setupContract.checkSetupStatus).handler(async () => {
      this.logger.log('Checking setup status');
      const status = await this.setupService.checkSetupStatus();
      return this.setupAdapter.adaptSetupStatusToContract(status);
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

      // Create the user with superAdmin role using Better Auth
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

      // Create organization using Better Auth
      const orgName = input.organizationName || 'Default Organization';
      this.logger.log(`Creating organization: ${orgName}`);
      const orgResult = await this.authService.api.createOrganization({
        body: {
          name: orgName,
          slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          userId: createdUser.id,
        },
      });

      if (!orgResult) {
        throw new Error('Failed to create organization');
      }

      const createdOrg = orgResult;
      this.logger.log(`Organization created with id: ${createdOrg.id}`);

      // Add user as owner member using Better Auth
      this.logger.log(`Adding user as organization owner`);
      await this.authService.api.addMember({
        body: {
          organizationId: createdOrg.id,
          userId: createdUser.id,
          role: 'owner',
        },
      });

      this.logger.log('Initial setup completed successfully');
      
      // Transform to contract format
      return this.setupAdapter.adaptInitialUserToContract(
        {
          id: createdUser.id,
          name: createdUser.name,
          email: createdUser.email,
          role: 'superAdmin',
        },
        {
          id: createdOrg.id,
          name: createdOrg.name,
          slug: createdOrg.slug || '',
        }
      );
    });
  }
}
