import { Injectable, Logger } from '@nestjs/common';
// TODO: Install @nestjs/schedule to enable cron-based auto-verification
// import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ProjectDomainNotFoundError,
  DnsLookupError,
  VerificationTokenMismatchError,
  VerificationRecordNotFoundError,
  VerificationAttemptError,
} from '../errors';
import type { 
  VerificationInstructions, 
  VerifyDomainResult,
} from '../interfaces';
import * as dns from 'dns/promises';
import { randomBytes } from 'crypto';
import { ProjectDomainRepository } from '../repositories/project-domain.repository';

@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);

  constructor(private readonly projectDomainRepository: ProjectDomainRepository) {}

  /**
   * Generate a unique verification token for domain ownership.
   * 
   * Token format: deployer-verify-{random}-{registeredDomain}
   * 
   * The domain is included in the token to ensure verification is specific 
   * to the exact domain being registered. This prevents token reuse and makes
   * audit logs more readable.
   * 
   * @param registeredDomain - The domain or subdomain being registered
   * @returns A verification token in the format: deployer-verify-{random}-{domain}
   * 
   * @example
   * // Root domain
   * generateVerificationToken('example.com')
   * // Returns: 'deployer-verify-a1b2c3d4e5f6...-example.com'
   * 
   * @example
   * // Subdomain
   * generateVerificationToken('api.example.com')
   * // Returns: 'deployer-verify-a1b2c3d4e5f6...-api.example.com'
   */
  generateVerificationToken(registeredDomain: string): string {
    const randomPart = randomBytes(16).toString('hex');
    return `deployer-verify-${randomPart}-${registeredDomain}`;
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
   * Verify a project domain's ownership via DNS records
   */
  async verifyProjectDomain(projectId: string, domainId: string): Promise<VerifyDomainResult> {
    const projectDomain = await this.projectDomainRepository.findById(domainId);

    if (!projectDomain || projectDomain.projectId !== projectId) {
      throw new ProjectDomainNotFoundError(domainId);
    }

    // Check if already verified
    if (projectDomain.verificationStatus === 'verified' && projectDomain.verifiedAt) {
      return {
        success: true,
        status: 'verified',
        message: 'Domain is already verified',
        verifiedAt: projectDomain.verifiedAt,
      };
    }

    const recordName = `_deployer-verify.${projectDomain.domain}`;

    try {
      // Query DNS based on verification method
      let verified = false;

      if (projectDomain.verificationMethod === 'txt_record') {
        verified = await this.verifyTxtRecord(recordName, projectDomain.verificationToken, projectDomain.domain);
      } else {
        verified = await this.verifyCnameRecord(recordName, projectDomain.verificationToken, projectDomain.domain);
      }

      // Update domain status
      if (verified) {
        const now = new Date();
        await this.projectDomainRepository.update(domainId, {
          verificationStatus: 'verified',
          verifiedAt: now,
          dnsRecordChecked: true,
          lastVerificationAttempt: now,
          updatedAt: now,
        });

        this.logger.log(`Domain verified successfully: ${projectDomain.domain}`);

        return {
          success: true,
          status: 'verified',
          message: 'Domain verified successfully',
          verifiedAt: now,
        };
      } else {
        const now = new Date();
        await this.projectDomainRepository.update(domainId, {
          verificationStatus: 'failed',
          dnsRecordChecked: true,
          lastVerificationAttempt: now,
          updatedAt: now,
        });

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
      // Re-throw domain-specific errors
      if (error instanceof ProjectDomainNotFoundError ||
          error instanceof DnsLookupError ||
          error instanceof VerificationTokenMismatchError ||
          error instanceof VerificationRecordNotFoundError) {
        throw error;
      }

      const err = error as Error;
      this.logger.error(`[${VerificationAttemptError.name}] Domain verification failed for ${projectDomain.domain}: ${err.message}`, err.stack);
      
      throw new VerificationAttemptError(domainId, err.message);
    }
  }

  /**
   * Verify TXT record
   */
  private async verifyTxtRecord(
    recordName: string,
    expectedToken: string,
    domain: string
  ): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(recordName);
      
      // TXT records are returned as arrays of strings
      for (const record of records) {
        const value = Array.isArray(record) ? record.join('') : record;
        if (value === expectedToken) {
          return true;
        }
      }
      
      // Record found but token doesn't match
      this.logger.debug(`[${VerificationTokenMismatchError.name}] TXT record token mismatch for ${domain}`);
      return false;
    } catch (error) {
      const err = error as Error;
      this.logger.debug(`[${DnsLookupError.name}] TXT record lookup failed for ${recordName}: ${err.message}`);
      return false;
    }
  }

  /**
   * Verify CNAME record
   */
  private async verifyCnameRecord(
    recordName: string,
    expectedToken: string,
    domain: string
  ): Promise<boolean> {
    try {
      const records = await dns.resolveCname(recordName);
      const expectedValue = `verify-${expectedToken}.deployer.io`;
      
      if (records.some(record => record === expectedValue)) {
        return true;
      }
      
      // Record found but value doesn't match
      this.logger.debug(`[${VerificationTokenMismatchError.name}] CNAME record value mismatch for ${domain}`);
      return false;
    } catch (error) {
      const err = error as Error;
      this.logger.debug(`[${DnsLookupError.name}] CNAME record lookup failed for ${recordName}: ${err.message}`);
      return false;
    }
  }

  /**
   * Auto-verify pending domains (runs hourly)
   * TODO: Uncomment @Cron decorator when @nestjs/schedule is installed
   */
  // @Cron(CronExpression.EVERY_HOUR)
  async autoVerifyPendingDomains() {
    this.logger.log('Running auto-verification for pending domains...');

    try {
      // Get all pending project domains
      const pendingDomains = await this.projectDomainRepository.findPending();

      this.logger.log(`Found ${String(pendingDomains.length)} pending domains to verify`);

      for (const domain of pendingDomains) {
        try {
          const result = await this.verifyProjectDomain(domain.projectId, domain.id);
          
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
   * Get the number of pending domains for a project
   */
  async getPendingDomainsCount(projectId: string): Promise<number> {
    const domains = await this.projectDomainRepository.findByProjectId(projectId);
    return domains.filter(d => d.verificationStatus === 'pending').length;
  }

  /**
   * Retry failed verification
   */
  async retryVerification(projectId: string, domainId: string): Promise<VerifyDomainResult> {
    // Reset status to pending before retrying
    await this.projectDomainRepository.update(domainId, {
      verificationStatus: 'pending',
      updatedAt: new Date(),
    });

    // Trigger verification
    return await this.verifyProjectDomain(projectId, domainId);
  }
}