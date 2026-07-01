import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { Roles } from '@repo/auth/permissions';
import * as schema from '../../config/drizzle/global/schema';
import { AuthCoreService } from '../../core/modules/auth/services/auth-core.service';
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service';

// Temporary seed user email for when other auth methods fail
const TEMP_SEED_USER_EMAIL = '__seed_temp_user__@internal.seed';

/**
 * Authentication method used for CLI operations
 */
export type CliAuthMethod = 'master-token' | 'default-admin-credentials' | 'temp-seed-user';

/**
 * Authentication context for CLI operations
 */
export interface CliAuthContext {
  /** The authenticated headers to use with plugin registry */
  headers: Headers;
  /** Cleanup function to call after operations complete (e.g., delete temp user) */
  cleanup: () => Promise<void>;
  /** Description of how authentication was obtained */
  method: CliAuthMethod;
}

/**
 * Service for handling authentication in CLI context.
 * 
 * Provides a smart authentication strategy that tries multiple methods in order:
 * 1. Master token (if DEV_AUTH_KEY and ENABLE_MASTER_TOKEN are configured)
 * 2. Default admin credentials (if DEFAULT_ADMIN_EMAIL and password are available)
 * 3. Temporary seed user (creates a temp superAdmin, uses it, then deletes it)
 * 
 * This service is designed to work in CLI context where there's no HTTP request.
 */
@Injectable()
export class CliAuthService {
  private readonly logger = new Logger(CliAuthService.name);
  constructor(
    private readonly databaseService: GlobalDatabaseService,
    private readonly authCoreService: AuthCoreService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Gets the auth core service for direct API access
   */
  getAuthCoreService(): AuthCoreService {
    return this.authCoreService;
  }

  /**
   * Smart authentication strategy for obtaining authenticated headers.
   * 
   * Tries methods in order:
   * 1. Master token (if DEV_AUTH_KEY and ENABLE_MASTER_TOKEN are configured)
   * 2. Default admin credentials (if DEFAULT_ADMIN_EMAIL and password are available)
   * 3. Temporary seed user (creates a temp superAdmin, uses it, then deletes it)
   * 
   * @param options - Optional parameters
   * @param options.defaultAdminPassword - Password for default admin if known (e.g., just created)
   * @param options.verbose - Whether to log authentication progress (default: true)
   * @returns Authentication context with headers and cleanup function
   */
  async getAuthenticatedHeaders(options?: {
    defaultAdminPassword?: string | null;
    verbose?: boolean;
  }): Promise<CliAuthContext> {
    const verbose = options?.verbose ?? true;
    const defaultAdminPassword = options?.defaultAdminPassword ?? null;

    const devAuthKey = this.configService.get<string>('DEV_AUTH_KEY');
    const enableMasterToken = this.configService.get<boolean>('ENABLE_MASTER_TOKEN');
    const defaultAdminEmail = this.configService.get<string>('DEFAULT_ADMIN_EMAIL');
    const envAdminPassword = this.configService.get<string>('DEFAULT_ADMIN_PASSWORD');

    // Strategy 1: Try master token authentication
    if (devAuthKey && enableMasterToken) {
      if (verbose) this.logger.log('   🔑 Trying master token authentication...');
      try {
        const authHeaders = new Headers({
          Authorization: `Bearer ${devAuthKey}`,
          'User-Agent': 'CLI-Command',
          'Content-Type': 'application/json',
        });

        const plugins = this.authCoreService.getRegistry().getAll(authHeaders);
        
        // Test if master token works by trying to list users
        await plugins.admin.listUsers();
        
        return {
          headers: authHeaders,
          cleanup: async () => { /* No cleanup needed for master token */ },
          method: 'master-token',
        };
      } catch (error) {
        if (verbose) {
          this.logger.log(`   ⚠️ Master token auth failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // Strategy 2: Try default admin credentials
    const adminPassword = envAdminPassword ?? defaultAdminPassword;
    if (defaultAdminEmail && adminPassword) {
      if (verbose) this.logger.log('   🔑 Trying default admin credentials...');
      try {
        const session = await this.signInAsUser(defaultAdminEmail, adminPassword);
        if (session) {
          // Use the headers with Cookie request header (converted from Set-Cookie)
          const plugins = this.authCoreService.getRegistry().getAll(session.headers);
          
          // Test if credentials work
          await plugins.admin.listUsers();
          
          return {
            headers: session.headers,
            cleanup: async () => { /* No cleanup needed */ },
            method: 'default-admin-credentials',
          };
        }
      } catch (error) {
        if (verbose) {
          this.logger.log(`   ⚠️ Default admin auth failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // Strategy 3: Create temporary seed user
    if (verbose) this.logger.log('   🔑 Creating temporary seed user...');
    return await this.createTempUser({ verbose });
  }

  /**
   * Sign in as a user and return their session headers for subsequent requests
   */
  async signInAsUser(email: string, password: string): Promise<{ headers: Headers; userId: string } | null> {
    try {
      const { headers, response: result } = await this.authCoreService.api.signInEmail({
        body: { email, password },
        returnHeaders: true,
      });

      if ('token' in result && typeof result.token === 'string') {
        // Convert Set-Cookie response headers to Cookie request header
        // Set-Cookie format: "name=value; attributes..."
        // Cookie format: "name=value"
        const setCookieHeader = headers.get('set-cookie');
        
        if (setCookieHeader) {
          // Parse Set-Cookie header(s) to extract cookie name=value pairs
          const cookiePairs: string[] = [];
          // headers.get() returns string | null, but set-cookie can be comma-separated
          const setCookieArray = setCookieHeader.includes(',') 
            ? setCookieHeader.split(',').map(s => s.trim())
            : [setCookieHeader];
          
          for (const setCookie of setCookieArray) {
            // Extract cookie name=value (before first semicolon)
            const match = /^([^;]+)/.exec(setCookie);
            if (match?.[1]) {
              cookiePairs.push(match[1].trim());
            }
          }
          
          if (cookiePairs.length > 0) {
            // Create Cookie request header
            const cookieValue = cookiePairs.join('; ');
            
            const requestHeaders = new Headers({
              Cookie: cookieValue,
              'User-Agent': 'CLI-Command',
              'Content-Type': 'application/json',
            });
            
            return {
              headers: requestHeaders,
              userId: result.user.id,
            };
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Creates a temporary superAdmin user for CLI operations.
   * This user should be deleted after operations complete using the cleanup function.
   */
  async createTempUser(options?: { verbose?: boolean }): Promise<CliAuthContext> {
    const verbose = options?.verbose ?? true;
    const tempPassword = nanoid(32);
    const now = new Date();

    // Create temp user directly in database with superAdmin role
    const userId = nanoid();
    
    await this.databaseService.db.insert(schema.user).values({
      id: userId,
      name: 'Temporary CLI User',
      email: TEMP_SEED_USER_EMAIL,
      emailVerified: true,
      role: Roles.superAdmin,
      createdAt: now,
      updatedAt: now,
    });

    // Create account record
    const { hashPassword } = await import('better-auth/crypto');
    const hashedPassword = await hashPassword(tempPassword);
    
    const accountId = nanoid();
    await this.databaseService.db.insert(schema.account).values({
      id: accountId,
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    });

    if (verbose) this.logger.log(`   ✅ Created temporary CLI user (ID: ${userId})`);

    // Sign in as temp user
    const session = await this.signInAsUser(TEMP_SEED_USER_EMAIL, tempPassword);
    if (!session) {
      // Cleanup and throw
      await this.deleteTempUser(userId, accountId);
      throw new Error('Failed to sign in as temporary CLI user');
    }

    // Use the headers with Cookie request header (converted from Set-Cookie)
    return {
      headers: session.headers,
      cleanup: async () => {
        if (verbose) this.logger.log('\n🧹 Cleaning up temporary CLI user...');
        await this.deleteTempUser(userId, accountId);
        if (verbose) this.logger.log('   ✅ Temporary CLI user deleted');
      },
      method: 'temp-seed-user',
    };
  }

  /**
   * Deletes a temporary user and their account
   */
  async deleteTempUser(userId: string, accountId: string): Promise<void> {
    // Delete sessions for this user first
    await this.databaseService.db
      .delete(schema.session)
      .where(eq(schema.session.userId, userId));

    // Delete account
    await this.databaseService.db
      .delete(schema.account)
      .where(eq(schema.account.id, accountId));

    // Delete user
    await this.databaseService.db
      .delete(schema.user)
      .where(eq(schema.user.id, userId));
  }

  /**
   * Bootstrap: Creates the dev auth user if DEFAULT_ADMIN_EMAIL is configured.
   * This user can be impersonated using the master token authentication in development.
   * 
   * IMPORTANT: This method creates the user directly in the database (not via admin plugin)
   * because it's a bootstrap operation - the masterTokenPlugin needs this user to exist
   * before any authenticated admin operations can work.
   */
  async ensureDevAuthUser(): Promise<void> {
    const devAuthEmail = this.configService.get<string>('DEFAULT_ADMIN_EMAIL');

    if (!devAuthEmail) {
      this.logger.log('ℹ️  DEFAULT_ADMIN_EMAIL not configured, skipping dev auth user creation');
      return;
    }

    this.logger.log(`🔐 Creating dev auth user for email: ${devAuthEmail}...`);

    // Check if user already exists using direct database query
    const existingUser = await this.databaseService.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, devAuthEmail))
      .limit(1);
    
    if (existingUser.length > 0 && existingUser[0]) {
      const existing = existingUser[0];

      if (existing.role !== Roles.superAdmin) {
        await this.databaseService.db
          .update(schema.user)
          .set({
            role: Roles.superAdmin,
            updatedAt: new Date(),
          })
          .where(eq(schema.user.id, existing.id));

        this.logger.log(`✅ Upgraded dev auth user role to superAdmin: ${devAuthEmail} (ID: ${existing.id})`);
        return;
      }

      this.logger.log(`✅ Dev auth user already exists: ${devAuthEmail} (ID: ${existing.id})`);
      return;
    }

    // Generate a random password (not needed for dev auth, but required for account record)
    const randomPassword = nanoid(32);

    try {
      // Use type-safe Roles accessor
      const superAdminRole = Roles.superAdmin;
      
      // BOOTSTRAP: Create user directly in database since admin plugin needs this user to exist first
      const userId = nanoid();
      const now = new Date();
      
      // Create user record
      await this.databaseService.db.insert(schema.user).values({
        id: userId,
        name: 'Dev Auth User',
        email: devAuthEmail,
        emailVerified: true,
        role: superAdminRole,
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
        createdAt: now,
        updatedAt: now,
      });

      // Create account record for email/password auth (required by Better Auth)
      const { hashPassword } = await import('better-auth/crypto');
      const hashedPassword = await hashPassword(randomPassword);
      
      await this.databaseService.db.insert(schema.account).values({
        id: nanoid(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      });

      this.logger.log(`✅ Created dev auth user: ${devAuthEmail} (ID: ${userId})`);
      this.logger.log(`   This user can be impersonated using DEV_AUTH_KEY in development mode`);
    } catch (error) {
      // If user creation fails, log and continue
      this.logger.warn(`⚠️  Could not create dev auth user: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Bootstrap: Creates a default admin user if DEFAULT_ADMIN_EMAIL is configured but user doesn't exist.
   * This is a fallback for when create-default-admin didn't run or wasn't configured.
   * 
   * Creates the user with a random password and LOGS it so the administrator can use it.
   * Returns the password so it can be used for authentication.
   */
  async ensureDefaultAdminUser(): Promise<string | null> {
    const defaultAdminEmail = this.configService.get<string>('DEFAULT_ADMIN_EMAIL');
    const envPassword = this.configService.get<string>('DEFAULT_ADMIN_PASSWORD');

    if (!defaultAdminEmail) {
      this.logger.log('ℹ️  DEFAULT_ADMIN_EMAIL not configured, skipping default admin user creation');
      return null;
    }

    this.logger.log(`👤 Checking for default admin user: ${defaultAdminEmail}...`);

    // Check if user already exists using direct database query
    const existingUser = await this.databaseService.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, defaultAdminEmail))
      .limit(1);
    
    if (existingUser.length > 0 && existingUser[0]) {
      const existing = existingUser[0];

      if (existing.role !== Roles.superAdmin) {
        await this.databaseService.db
          .update(schema.user)
          .set({
            role: Roles.superAdmin,
            updatedAt: new Date(),
          })
          .where(eq(schema.user.id, existing.id));

        this.logger.log(`✅ Upgraded default admin user role to superAdmin: ${defaultAdminEmail} (ID: ${existing.id})`);
      } else {
        this.logger.log(`✅ Default admin user already exists: ${defaultAdminEmail} (ID: ${existing.id})`);
      }

      // Return env password if available (user might need it for auth)
      return envPassword ?? null;
    }

    // Use env password or generate a random one
    const password = envPassword ?? nanoid(16);

    try {
      // Use type-safe Roles accessor - super admin role for default admin bootstrap
      const adminRole = Roles.superAdmin;
      
      // Create user directly in database (bootstrap operation)
      const userId = nanoid();
      const now = new Date();
      
      // Create user record
      await this.databaseService.db.insert(schema.user).values({
        id: userId,
        name: 'Default Admin',
        email: defaultAdminEmail,
        emailVerified: true,
        role: adminRole,
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
        createdAt: now,
        updatedAt: now,
      });

      // Create account record for email/password auth (required by Better Auth)
      const { hashPassword } = await import('better-auth/crypto');
      const hashedPassword = await hashPassword(password);
      
      await this.databaseService.db.insert(schema.account).values({
        id: nanoid(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      });

      if (!envPassword) {
        const separator = '═'.repeat(60);
        this.logger.log(`\n${separator}`);
        this.logger.log(`🔑 DEFAULT ADMIN USER CREATED`);
        this.logger.log(separator);
        this.logger.log(`   Email:    ${defaultAdminEmail}`);
        this.logger.log(`   Password: ${password}`);
        this.logger.log(`   User ID:  ${userId}`);
        this.logger.log(separator);
        this.logger.log(`⚠️  SAVE THIS PASSWORD! It won't be shown again.`);
        this.logger.log(`   You can also set DEFAULT_ADMIN_PASSWORD env var to use a specific password.`);
        this.logger.log(`${separator}\n`);
      } else {
        this.logger.log(`✅ Created default admin user: ${defaultAdminEmail} (ID: ${userId})`);
      }

      return password;
    } catch (error) {
      this.logger.warn(`⚠️  Could not create default admin user: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
