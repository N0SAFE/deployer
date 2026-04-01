import { GlobalDatabaseService } from '@/core/modules/database/services/global-database.service';
import { CliAuthService, type CliAuthContext } from '../../services/cli-auth.service';
import { AuthCoreService } from '@/core/modules/auth/services/auth-core.service';
import * as schema from '@/config/drizzle/global/schema';
import { eq } from 'drizzle-orm';
import { Roles, ORGANIZATION_ROLES, type OrganizationRole } from '@repo/auth/permissions';

// Seed version identifier - increment this when you want to re-seed
export const SEED_VERSION = 'v1.2.0';

export async function seedGlobal(
  databaseService: GlobalDatabaseService,
  authCoreService: AuthCoreService,
  cliAuthService: CliAuthService
): Promise<void> {
  let authContext: CliAuthContext | null = null;
  console.log(`📦 Applying global seed version ${SEED_VERSION}...`);

  try {
    // Check if this seed version has already been applied
    const existingSeed = await databaseService.db
      .select()
      .from(schema.seedVersion)
      .where(eq(schema.seedVersion.version, SEED_VERSION))
      .limit(1);

    if (existingSeed.length > 0 && existingSeed[0]) {
      console.log(`✅ Seed version ${SEED_VERSION} already applied at ${existingSeed[0].appliedAt.toISOString()}`);
      console.log('   Skipping seeding. To re-seed, increment SEED_VERSION in seed.command.ts');
      return;
    }

    const totalStart = Date.now();

    // BOOTSTRAP: Create dev auth user first (via direct DB) - needed for masterTokenPlugin
    let start = Date.now();
    await cliAuthService.ensureDevAuthUser();
    console.log(`   ⏱️ Bootstrap user: ${String(Date.now() - start)}ms`);

    // BOOTSTRAP: Create default admin user if not created by create-default-admin command
    start = Date.now();
    const defaultAdminPassword = await cliAuthService.ensureDefaultAdminUser();
    console.log(`   ⏱️ Default admin check: ${String(Date.now() - start)}ms`);

    // Get authenticated headers using smart auth strategy
    console.log('\n🔐 Obtaining authentication for seeding...');
    start = Date.now();
    authContext = await cliAuthService.getAuthenticatedHeaders({ defaultAdminPassword });
    console.log(`   ✅ Authenticated via: ${authContext.method}`);
    console.log(`   ⏱️ Auth setup: ${String(Date.now() - start)}ms`);

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
    console.log('\n📝 Creating users with platform roles...');
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
          console.log(`   Created ${role} user ${String(i)}: ${email} (ID: ${user.id})`);
        });
        
        userCreationPromises.push(promise);
      }
    }
    
    await Promise.all(userCreationPromises);
    console.log(`   ⏱️ Users created: ${String(Date.now() - start)}ms`);

    // Create test organizations using Better Auth API
    console.log('\n🏢 Creating test organizations with Better Auth API...');
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
      console.log(`   Created organization: ${orgResult.name} (ID: ${orgResult.id})`);
    });
    
    await Promise.all(orgCreationPromises);
    console.log(`   ⏱️ Test organizations created: ${String(Date.now() - start)}ms`);

    // Create one organization per user
    console.log('\n🏢 Creating personal organizations for each user...');
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
      console.log(`   Created personal org: ${orgResult.name} (ID: ${orgResult.id})`);
    });
    
    await Promise.all(personalOrgPromises);
    console.log(`   ⏱️ Personal organizations created: ${String(Date.now() - start)}ms`);

    // Assign users to test organizations only (not personal organizations)
    console.log('\n👥 Assigning users to test organizations...');
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
        console.log(`\n   ⏭️ Skipping personal organization: ${org.name} (user is already owner)`);
        continue;
      }
      
      console.log(`\n   Organization: ${org.name}`);
      
      for (const userData of seededData.users) {
        const orgRole = platformToOrgRoleMap[userData.role] ?? 'member';
        
        const promise = orgPlugin.addMember(org.id, userData.id, orgRole)
          .then(() => {
            console.log(`      Added ${userData.email} as ${orgRole}`);
          })
          .catch((error: unknown) => {
            console.warn(`      ⚠️ Could not add ${userData.email}: ${error instanceof Error ? error.message : String(error)}`);
          });
        
        memberAdditionPromises.push(promise);
      }
    }
    
    await Promise.all(memberAdditionPromises);
    console.log(`   ⏱️ Members added to test organizations: ${String(Date.now() - start)}ms`);

    // Record that this seed version has been applied
    await databaseService.db.insert(schema.seedVersion).values({
      version: SEED_VERSION,
    });

    console.log(`\n✅ Global Database seeded successfully (version ${SEED_VERSION})`);
    console.log(`   ⏱️ Total seed time: ${String(Date.now() - totalStart)}ms`);

  } catch (error) {
    console.error("❌ Global Seeding failed:", error);
    throw error;
  } finally {
    if (authContext) {
      try {
        await authContext.cleanup();
      } catch (cleanupError) {
        console.warn(`⚠️ Cleanup warning: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
  }
}
