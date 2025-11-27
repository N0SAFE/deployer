import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { 
  networkAssignments, 
  sslCertificates, 
  orchestrationStacks 
} from '@/config/drizzle/schema/orchestration';
import { eq, and } from 'drizzle-orm';

@Injectable()
export class TraefikRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findNetworkAssignment(stackId: string, networkName: string) {
    // Network assignments are by projectId, not stackId
    // Need to find project from stack first
    const stack = await this.findStackById(stackId);
    if (!stack) return [];
    
    return this.databaseService.db
      .select()
      .from(networkAssignments)
      .where(
        and(
          eq(networkAssignments.projectId, stack.projectId),
          eq(networkAssignments.networkName, networkName)
        )
      );
  }

  async createNetworkAssignment(data: {
    stackId: string;
    networkName: string;
    internalName?: string;
    isExternal: boolean;
  }) {
    // Get stack to find projectId
    const stack = await this.findStackById(data.stackId);
    if (!stack) throw new Error('Stack not found');
    
    return this.databaseService.db.insert(networkAssignments).values({
      projectId: stack.projectId,
      networkName: data.networkName,
      networkId: data.networkName, // Use networkName as networkId for now
      networkType: 'overlay' as any,
      environment: stack.environment,
      isActive: true,
    });
  }

  async updateNetworkAssignment(
    stackId: string, 
    networkName: string, 
    internalName: string
  ) {
    // Get stack to find projectId
    const stack = await this.findStackById(stackId);
    if (!stack) return null;
    
    return this.databaseService.db
      .update(networkAssignments)
      .set({ 
        networkId: internalName, 
        updatedAt: new Date() 
      })
      .where(
        and(
          eq(networkAssignments.projectId, stack.projectId),
          eq(networkAssignments.networkName, networkName)
        )
      );
  }

  async findCertificateByDomain(domain: string) {
    return this.databaseService.db
      .select()
      .from(sslCertificates)
      .where(eq(sslCertificates.domain, domain));
  }

  async createCertificate(data: {
    domain: string;
    certificatePath?: string;
    keyPath?: string;
    provider: string;
    autoRenew: boolean;
  }) {
    return this.databaseService.db.insert(sslCertificates).values({
      domain: data.domain,
      certificatePath: data.certificatePath,
      privateKeyPath: data.keyPath,
      issuer: data.provider,
      autoRenew: data.autoRenew,
      renewalStatus: 'pending',
    });
  }

  async findStackById(stackId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.id, stackId));
    return result || null;
  }

  async updateStackTraefikConfig(stackId: string, traefikConfig: any) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ domainMappings: traefikConfig, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async findCertificateById(certId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(sslCertificates)
      .where(eq(sslCertificates.id, certId));
    return result || null;
  }

  async updateCertificateStatus(certId: string, status: string, data?: {
    certificatePath?: string;
    keyPath?: string;
    chainPath?: string;
    expiresAt?: Date;
  }) {
    return this.databaseService.db
      .update(sslCertificates)
      .set({ 
        renewalStatus: status, 
        certificatePath: data?.certificatePath,
        privateKeyPath: data?.keyPath,
        expiresAt: data?.expiresAt,
        updatedAt: new Date() 
      })
      .where(eq(sslCertificates.id, certId));
  }

  async findStackByName(name: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.name, name))
      .limit(1);
    return result || null;
  }

  async findStackByProjectId(projectId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.projectId, projectId))
      .limit(1);
    return result || null;
  }

  async updateStackComposeConfig(stackId: string, composeConfig: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ composeConfig: JSON.parse(composeConfig) as any, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async findNetworkAssignmentByProjectEnv(
    projectId: string,
    environment: string,
    networkName: string
  ) {
    return this.databaseService.db
      .select()
      .from(networkAssignments)
      .where(
        and(
          eq(networkAssignments.projectId, projectId),
          eq(networkAssignments.environment, environment),
          eq(networkAssignments.networkName, networkName)
        )
      )
      .limit(1);
  }

  async createNetworkAssignmentWithProject(data: {
    projectId: string;
    networkName: string;
    networkId: string;
    networkType: string;
    environment: string;
    networkConfig: any;
    isActive: boolean;
  }) {
    return this.databaseService.db.insert(networkAssignments).values({
      projectId: data.projectId,
      networkName: data.networkName,
      networkId: data.networkId,
      networkType: data.networkType as any,
      environment: data.environment,
      networkConfig: data.networkConfig,
      isActive: data.isActive,
    });
  }

  async updateNetworkAssignmentById(id: string, networkId: string) {
    return this.databaseService.db
      .update(networkAssignments)
      .set({
        networkId,
        updatedAt: new Date()
      })
      .where(eq(networkAssignments.id, id));
  }

  async updateStackDomainMappings(stackId: string, domainMappings: any) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({
        domainMappings,
        updatedAt: new Date()
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateCertificateRenewalStatus(domain: string, renewalStatus: string) {
    return this.databaseService.db
      .update(sslCertificates)
      .set({
        lastRenewalAttempt: new Date(),
        renewalStatus,
        updatedAt: new Date()
      })
      .where(eq(sslCertificates.domain, domain));
  }
}
