import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { organizationDomains } from '@/config/drizzle/schema';
import * as dns from 'dns/promises';
import { randomBytes } from 'crypto';

export interface VerificationInstructions {
  method: 'txt_record' | 'cname_record';
  recordName: string;
  recordValue: string;
  instructions: string;
}

export interface VerifyDomainResult {
  success: boolean;
  status: 'verified' | 'failed';
  message: string;
  verifiedAt?: Date;
  error?: {
    code: string;
    details: string;
  };
}

@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Generate a unique verification token for domain ownership
   */
  generateVerificationToken(): string {
    return `deployer-verify-${randomBytes(16).toString('hex')}`;
  }

  /**
   * Get DNS verification instructions for a domain
   */
  getVerificationInstructions(
    domain: string,
    token: string,
    method: 'txt_record' | 'cname_record'
  ): VerificationInstructions {
    const recordName = `_deployer-verify.${domain}`;

    if (method === 'txt_record') {
      return {
        method: 'txt_record',
        recordName,
        recordValue: token,
        instructions: `
Add the following TXT record to your DNS configuration:

Record Type: TXT
Name: ${recordName}
Value: ${token}
TTL: 3600 (or minimum allowed)

The verification will be checked automatically within an hour, or you can trigger manual verification.
        `.trim(),
      };
    } else {
      return {
        method: 'cname_record',
        recordName,
        recordValue: `verify-${token}.deployer.io`,
        instructions: `
Add the following CNAME record to your DNS configuration:

Record Type: CNAME
Name: ${recordName}
Value: verify-${token}.deployer.io
TTL: 3600 (or minimum allowed)

The verification will be checked automatically within an hour, or you can trigger manual verification.
        `.trim(),
      };
    }
  }

  /**
   * Verify domain ownership via DNS records
   */
  async verifyDomain(domainId: string): Promise<VerifyDomainResult> {
    try {
      // Fetch domain details
      const [orgDomain] = await this.databaseService.db
        .select()
        .from(organizationDomains)
        .where(eq(organizationDomains.id, domainId))
        .limit(1);

      if (!orgDomain) {
        return {
          success: false,
          status: 'failed',
          message: 'Domain not found',
          error: {
            code: 'DOMAIN_NOT_FOUND',
            details: 'The specified domain does not exist',
          },
        };
      }

      // Check if already verified
      if (orgDomain.verificationStatus === 'verified') {
        return {
          success: true,
          status: 'verified',
          message: 'Domain is already verified',
          verifiedAt: orgDomain.verifiedAt!,
        };
      }

      const recordName = `_deployer-verify.${orgDomain.domain}`;

      // Query DNS based on verification method
      let verified = false;

      if (orgDomain.verificationMethod === 'txt_record') {
        verified = await this.verifyTxtRecord(recordName, orgDomain.verificationToken);
      } else {
        verified = await this.verifyCnameRecord(recordName, orgDomain.verificationToken);
      }

      // Update domain status
      if (verified) {
        const now = new Date();
        await this.databaseService.db
          .update(organizationDomains)
          .set({
            verificationStatus: 'verified',
            verifiedAt: now,
            dnsRecordChecked: true,
            lastVerificationAttempt: now,
            updatedAt: now,
          })
          .where(eq(organizationDomains.id, domainId));

        this.logger.log(`Domain verified successfully: ${orgDomain.domain}`);

        return {
          success: true,
          status: 'verified',
          message: 'Domain verified successfully',
          verifiedAt: now,
        };
      } else {
        const now = new Date();
        await this.databaseService.db
          .update(organizationDomains)
          .set({
            verificationStatus: 'failed',
            dnsRecordChecked: true,
            lastVerificationAttempt: now,
            updatedAt: now,
          })
          .where(eq(organizationDomains.id, domainId));

        return {
          success: false,
          status: 'failed',
          message: 'DNS record not found or token mismatch',
          error: {
            code: 'DNS_VERIFICATION_FAILED',
            details: 'Please check your DNS configuration and try again. DNS changes can take up to 48 hours to propagate.',
          },
        };
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Domain verification failed: ${err.message}`, err.stack);
      
      return {
        success: false,
        status: 'failed',
        message: 'Verification failed due to an error',
        error: {
          code: 'VERIFICATION_ERROR',
          details: err.message,
        },
      };
    }
  }

  /**
   * Verify TXT record
   */
  private async verifyTxtRecord(recordName: string, expectedToken: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(recordName);
      
      // TXT records are returned as arrays of strings
      for (const record of records) {
        const value = Array.isArray(record) ? record.join('') : record;
        if (value === expectedToken) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      const err = error as Error;
      this.logger.debug(`TXT record lookup failed for ${recordName}: ${err.message}`);
      return false;
    }
  }

  /**
   * Verify CNAME record
   */
  private async verifyCnameRecord(recordName: string, expectedToken: string): Promise<boolean> {
    try {
      const records = await dns.resolveCname(recordName);
      const expectedValue = `verify-${expectedToken}.deployer.io`;
      
      return records.some(record => record === expectedValue);
    } catch (error) {
      const err = error as Error;
      this.logger.debug(`CNAME record lookup failed for ${recordName}: ${err.message}`);
      return false;
    }
  }

  /**
   * Auto-verify pending domains (runs hourly)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoVerifyPendingDomains() {
    this.logger.log('Running auto-verification for pending domains...');

    try {
      // Get all pending domains
      const pendingDomains = await this.databaseService.db
        .select()
        .from(organizationDomains)
        .where(eq(organizationDomains.verificationStatus, 'pending'));

      this.logger.log(`Found ${pendingDomains.length} pending domains to verify`);

      for (const domain of pendingDomains) {
        try {
          const result = await this.verifyDomain(domain.id);
          
          if (result.success) {
            this.logger.log(`Auto-verified domain: ${domain.domain}`);
          } else {
            this.logger.debug(`Auto-verification failed for ${domain.domain}: ${result.message}`);
          }
        } catch (error) {
          const err = error as Error;
          this.logger.error(
            `Auto-verification error for domain ${domain.domain}: ${err.message}`,
            err.stack
          );
        }
      }

      this.logger.log('Auto-verification completed');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Auto-verification job failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Get pending domains count
   */
  async getPendingDomainsCount(organizationId: string): Promise<number> {
    const result = await this.databaseService.db
      .select()
      .from(organizationDomains)
      .where(
        and(
          eq(organizationDomains.organizationId, organizationId),
          eq(organizationDomains.verificationStatus, 'pending')
        )
      );

    return result.length;
  }

  /**
   * Retry failed verification
   */
  async retryVerification(domainId: string): Promise<VerifyDomainResult> {
    // Reset status to pending before retrying
    await this.databaseService.db
      .update(organizationDomains)
      .set({
        verificationStatus: 'pending',
        dnsRecordChecked: false,
        updatedAt: new Date(),
      })
      .where(eq(organizationDomains.id, domainId));

    return this.verifyDomain(domainId);
  }
}
