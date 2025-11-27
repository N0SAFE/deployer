import { Injectable } from '@nestjs/common';
import type {
  SetupStatusContract,
  InitialUserContract,
} from '../interfaces/setup.types';

@Injectable()
export class SetupAdapter {
  /**
   * Transform setup status data to contract format
   */
  adaptSetupStatusToContract(data: {
    needsSetup: boolean;
    hasUsers: boolean;
  }): SetupStatusContract {
    return {
      needsSetup: data.needsSetup,
      hasUsers: data.hasUsers,
    };
  }

  /**
   * Transform initial user creation result to contract format
   */
  adaptInitialUserToContract(
    user: { id: string; name: string; email: string; role?: string },
    organization: { id: string; name: string; slug: string },
  ): InitialUserContract {
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'superAdmin',
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      session: {
        token: '', // Frontend will handle actual sign-in
        expiresAt: new Date().toISOString(),
      },
    };
  }
}
