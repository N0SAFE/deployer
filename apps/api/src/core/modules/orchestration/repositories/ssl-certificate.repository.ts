import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { sslCertificates } from '@/config/drizzle/schema/orchestration';
import { eq, lt, and } from 'drizzle-orm';

@Injectable()
export class SslCertificateRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findExpiringCertificates(daysFromNow: number) {
    return this.databaseService.db
      .select()
      .from(sslCertificates)
      .where(
        and(
          eq(sslCertificates.autoRenew, true),
          lt(sslCertificates.expiresAt, new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000))
        )
      );
  }

  async findAll() {
    return this.databaseService.db.select().from(sslCertificates);
  }

  async updateRenewalStatus(domain: string, isRenewing: boolean) {
    return this.databaseService.db
      .update(sslCertificates)
      .set({ renewalStatus: isRenewing ? 'pending' : 'success', updatedAt: new Date() })
      .where(eq(sslCertificates.domain, domain));
  }

  async updateRenewalError(domain: string, error: string) {
    return this.databaseService.db
      .update(sslCertificates)
      .set({
        renewalStatus: 'failed',
        errorMessage: error,
        updatedAt: new Date(),
      })
      .where(eq(sslCertificates.domain, domain));
  }

  async updateCertificate(domain: string, data: {
    certificatePath?: string;
    keyPath?: string;
    chainPath?: string;
    expiresAt?: Date;
    renewalStatus?: string;
    errorMessage?: string;
  }) {
    return this.databaseService.db
      .update(sslCertificates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sslCertificates.domain, domain));
  }

  async findByDomain(domain: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(sslCertificates)
      .where(eq(sslCertificates.domain, domain));
    return result || null;
  }

  async findByDomainOrCreate(domain: string, initialData?: any) {
    const existing = await this.databaseService.db
      .select()
      .from(sslCertificates)
      .where(eq(sslCertificates.domain, domain));

    if (existing.length === 0 && initialData) {
      await this.databaseService.db.insert(sslCertificates).values({
        domain,
        ...initialData,
      });
    }

    return existing[0] || null;
  }

  async findExpiringCertificatesForNotification(daysBefore: number) {
    return this.databaseService.db
      .select()
      .from(sslCertificates)
      .where(
        and(
          eq(sslCertificates.autoRenew, true),
          lt(sslCertificates.expiresAt, new Date(Date.now() + daysBefore * 24 * 60 * 60 * 1000))
        )
      );
  }

  async markAsRenewing(domain: string) {
    return this.databaseService.db
      .update(sslCertificates)
      .set({ renewalStatus: 'pending', updatedAt: new Date() })
      .where(eq(sslCertificates.domain, domain));
  }
}
