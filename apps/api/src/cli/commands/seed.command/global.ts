import { Logger } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/config/drizzle/global/schema';
import type { CliAuthService} from '../../services/cli-auth.service';
import { type CliAuthContext } from '../../services/cli-auth.service';
import type { AuthCoreService } from '@/core/modules/auth/services/auth-core.service';
import { eq } from 'drizzle-orm';
import { Roles, ORGANIZATION_ROLES, type OrganizationRole } from '@repo/auth/permissions';

// Seed version identifier - increment this when you want to re-seed
export const SEED_VERSION = 'v1.2.0';

const logger = new Logger('SeedGlobal');

export async function seedGlobal(
  globalDb: NodePgDatabase<typeof schema>,
  authCoreService: AuthCoreService,
  cliAuthService: CliAuthService
) {
  let authContext: CliAuthContext | null = null;
  logger.log(`📦 Applying global seed version ${SEED_VERSION}...`);

  try {
    // Check if this seed version has already been applied
    const existingSeed = await globalDb
      .select()
      .from(schema.seedVersion)
      .where(eq(schema.seedVersion.version, SEED_VERSION))
      .limit(1);

    if (existingSeed.length > 0 && existingSeed[0]) {
      logger.log(`✅ Seed version ${SEED_VERSION} already applied at ${existingSeed[0].appliedAt.toISOString()}`);
      logger.log('   Skipping seeding. To re-seed, increment SEED_VERSION in seed.command.ts');
      return;
    }

    const totalStart = Date.now();

    // BOOTSTRAP: Create dev auth user first (via direct DB) - needed for masterTokenPlugin
    let start = Date.now();
    await cliAuthService.ensureDevAuthUser();
    logger.log(`   ⏱️ Bootstrap user: ${String(Date.now() - start)}ms`);

    // BOOTSTRAP: Create default admin user if not created by create-default-admin command
    start = Date.now();
    const defaultAdminPassword = await cliAuthService.ensureDefaultAdminUser();
    logger.log(`   ⏱️ Default admin check: ${String(Date.now() - start)}ms`);

    // Get authenticated headers using smart auth strategy
    logger.log('\n🔐 Obtaining authentication for seeding...');
    start = Date.now();
    authContext = await cliAuthService.getAuthenticatedHeaders({ defaultAdminPassword });
    logger.log(`   ✅ Authenticated via: ${authContext.method}`);
    logger.log(`   ⏱️ Auth setup: ${String(Date.now() - start)}ms`);

    // Get typed plugins bound to auth headers - this preserves proper typing from the registry
    const plugins = authCoreService.getRegistry().getAll(authContext.headers) as unknown as {
      admin: {
        createUser: (data: {
          name: string;
          email: string;
          password: string;
          data: {
            role: string;
            emailVerified: boolean;
            image: string;
          };
        }) => Promise<{ user: { id: string } }>;
      };
      organization: {
        createOrganization: (data: { name: string; slug: string }) => Promise<{
          id: string;
          name: string;
          slug: string;
        }>;
        addMember: (organizationId: string, userId: string, role: OrganizationRole) => Promise<unknown>;
      };
    };
    const adminPlugin = plugins.admin;
    const orgPlugin = plugins.organization;

    // Dynamically get roles from permissions using type-safe Roles accessor
    const platformRoleNames = Roles.all();
    const organizationRoleNames = ORGANIZATION_ROLES;
    const usersPerRole = 2;
    const seededData = { 
      users: [] as { role: string; id: string; email: string; password: string }[],
      organizations: [] as { id: string; name: string; slug: string }[],
    };

    // Create users for each platform role using authenticated admin plugin
    logger.log('\n📝 Creating users with platform roles...');
    start = Date.now();
    const userCreationPromises: Promise<void>[] = [];
    
    for (const role of platformRoleNames) {
      for (let i = 1; i <= usersPerRole; i++) {
        const email = `${role}${String(i)}@test.com`;
        const password = 'password123';
        
        const promise = adminPlugin.createUser({
          name: `${role.charAt(0).toUpperCase() + role.slice(1)} User ${String(i)}`,
          email,
          password,
          data: {
            role,
            emailVerified: true,
            image: `https://avatars.githubusercontent.com/u/${String(i)}?v=4`,
          },
        }).then(userResult => {
          const user = userResult.user;
          seededData.users.push({ role, id: user.id, email, password });
          logger.log(`   Created ${role} user ${String(i)}: ${email} (ID: ${user.id})`);
        });
        
        userCreationPromises.push(promise);
      }
    }
    
    await Promise.all(userCreationPromises);
    logger.log(`   ⏱️ Users created: ${String(Date.now() - start)}ms`);

    // Create test organizations using Better Auth API
    logger.log('\n🏢 Creating test organizations with Better Auth API...');
    start = Date.now();

    const testOrganizations = [
      { name: 'Test Organization A', slug: 'test-org-a' },
      { name: 'Test Organization B', slug: 'test-org-b' },
    ];

    const orgCreationPromises = testOrganizations.map(async (orgData) => {
      const orgResult = await orgPlugin.createOrganization({
        name: orgData.name,
        slug: orgData.slug,
      });

      seededData.organizations.push({
        id: orgResult.id,
        name: orgResult.name,
        slug: orgResult.slug,
      });
      logger.log(`   Created organization: ${orgResult.name} (ID: ${orgResult.id})`);
    });
    
    await Promise.all(orgCreationPromises);
    logger.log(`   ⏱️ Test organizations created: ${String(Date.now() - start)}ms`);

    // Create one organization per user
    logger.log('\n🏢 Creating personal organizations for each user...');
    start = Date.now();
    
    const personalOrgPromises = seededData.users.map(async (userData) => {
      const emailPrefix = userData.email.split('@')[0] ?? 'user';
      const orgName = `${emailPrefix}'s Organization`;
      const orgSlug = `${emailPrefix}-org`;

      const orgResult = await orgPlugin.createOrganization({
        name: orgName,
        slug: orgSlug,
      });

      seededData.organizations.push({
        id: orgResult.id,
        name: orgResult.name,
        slug: orgResult.slug,
      });
      logger.log(`   Created personal org: ${orgResult.name} (ID: ${orgResult.id})`);
    });
    
    await Promise.all(personalOrgPromises);
    logger.log(`   ⏱️ Personal organizations created: ${String(Date.now() - start)}ms`);

    // Assign users to test organizations only (not personal organizations)
    logger.log('\n👥 Assigning users to test organizations...');
    start = Date.now();
    
    const platformToOrgRoleMap: Record<string, OrganizationRole> = {
      'superAdmin': 'owner',
      'admin': 'admin',
      'user': 'member',
    };

    const memberAdditionPromises: Promise<void>[] = [];
    const testOrgIds = seededData.organizations.slice(0, 2).map(org => org.id);
    
    for (const org of seededData.organizations) {
      if (!testOrgIds.includes(org.id)) {
        logger.log(`\n   ⏭️ Skipping personal organization: ${org.name} (user is already owner)`);
        continue;
      }
      
      logger.log(`\n   Organization: ${org.name}`);
      
      for (const userData of seededData.users) {
        const orgRole = platformToOrgRoleMap[userData.role] ?? 'member';
        
        const promise = orgPlugin.addMember(org.id, userData.id, orgRole)
          .then(() => {
            logger.log(`      Added ${userData.email} as ${orgRole}`);
          })
          .catch((error: unknown) => {
            logger.warn(`      ⚠️ Could not add ${userData.email}: ${error instanceof Error ? error.message : String(error)}`);
          });
        
        memberAdditionPromises.push(promise);
      }
    }
    
    await Promise.all(memberAdditionPromises);
    logger.log(`   ⏱️ Members added to test organizations: ${String(Date.now() - start)}ms`);

    // Record that this seed version has been applied
    await globalDb.insert(schema.seedVersion).values({
      version: SEED_VERSION,
    });

    logger.log(`\n✅ Global Database seeded successfully (version ${SEED_VERSION})`);
    logger.log(`   ⏱️ Total seed time: ${String(Date.now() - totalStart)}ms`);

  } catch (error) {
    logger.error("❌ Global Seeding failed:", error);
    throw error;
  } finally {
    if (authContext) {
      try {
        await authContext.cleanup();
      } catch (cleanupError) {
        logger.warn(`⚠️ Cleanup warning: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
  }
}
