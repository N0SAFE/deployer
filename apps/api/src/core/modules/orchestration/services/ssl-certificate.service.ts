import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs-extra';
import * as forge from 'node-forge';
import { SslCertificateRepository } from '../repositories/ssl-certificate.repository';
export interface CertificateInfo {
    domain: string;
    notBefore: Date;
    notAfter: Date;
    issuer: string;
    subject: string;
    fingerprint: string;
    serialNumber: string;
    keyType: string;
    keySize: number;
    subjectAlternativeNames: string[];
    isValid: boolean;
    expiresIn: number; // days until expiration
}
@Injectable()
export class SslCertificateService {
    private readonly logger = new Logger(SslCertificateService.name);
    constructor(
    private readonly sslCertificateRepository: SslCertificateRepository,
    @InjectQueue('deployment')
    private deploymentQueue: Queue) { }
    /**
     * Monitor certificate expiry every day at 2 AM
     */
    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async monitorCertificateExpiry() {
        try {
            this.logger.log('Starting certificate expiry monitoring');
            // Find certificates expiring in the next 30 days
            const expiringCertificates = await this.sslCertificateRepository.findExpiringCertificates(30);
            for (const cert of expiringCertificates) {
                const daysUntilExpiry = Math.ceil((new Date(cert.expiresAt!).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                if (daysUntilExpiry <= 7) {
                    // Renew certificates expiring in 7 days or less
                    this.logger.log(`Certificate for ${cert.domain} expires in ${daysUntilExpiry} days, initiating renewal`);
                    await this.renewCertificate(cert.domain);
                }
                else if (daysUntilExpiry <= 30) {
                    // Log warning for certificates expiring within 30 days
                    this.logger.warn(`Certificate for ${cert.domain} expires in ${daysUntilExpiry} days`);
                }
            }
            this.logger.log(`Certificate monitoring completed. Found ${expiringCertificates.length} certificates to monitor`);
        }
        catch (error) {
            this.logger.error('Failed to monitor certificate expiry:', error);
        }
    }
    /**
     * Validate certificate expiry every 6 hours
     */
    @Cron(CronExpression.EVERY_6_HOURS)
    async validateCertificateFiles() {
        try {
            this.logger.log('Starting certificate file validation');
            // Get all valid certificates
            const certificates = await this.sslCertificateRepository.findAll();
            let validatedCount = 0;
            let errorCount = 0;
            for (const cert of certificates) {
                try {
                    const info = await this.parseCertificateFile(cert.certificatePath);
                    if (info) {
                        // Update database with parsed certificate information
                        await this.sslCertificateRepository.updateCertificate(cert.domain, {
                            expiresAt: info.notAfter,
                        });
                        validatedCount++;
                    }
                    else {
                        // Certificate file not found or invalid
                        await this.sslCertificateRepository.updateCertificate(cert.domain, {
                            renewalStatus: 'failed',
                            errorMessage: 'Certificate file not found or invalid'
                        });
                        errorCount++;
                    }
                }
                catch (error) {
                    this.logger.error(`Failed to validate certificate for ${cert.domain}:`, error);
                    errorCount++;
                }
            }
            this.logger.log(`Certificate validation completed. Validated: ${validatedCount}, Errors: ${errorCount}`);
        }
        catch (error) {
            this.logger.error('Failed to validate certificate files:', error);
        }
    }
    /**
     * Parse certificate file and extract information
     */
    async parseCertificateFile(certificatePath: string | null): Promise<CertificateInfo | null> {
        if (!certificatePath) {
            return null;
        }
        try {
            if (!(await fs.pathExists(certificatePath))) {
                return null;
            }
            const certPem = await fs.readFile(certificatePath, 'utf8');
            const cert = forge.pki.certificateFromPem(certPem);
            // Extract subject alternative names
            const sanExtension = cert.getExtension('subjectAltName') as any;
            const subjectAlternativeNames: string[] = [];
            if (sanExtension && sanExtension.altNames) {
                sanExtension.altNames.forEach((altName: any) => {
                    if (altName.type === 2) { // DNS name
                        subjectAlternativeNames.push(altName.value);
                    }
                });
            }
            // Calculate expiry time
            const now = new Date();
            const expiresIn = Math.ceil((cert.validity.notAfter.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            // Generate fingerprint
            const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
            const md = forge.md.sha256.create();
            md.update(der);
            const fingerprint = md.digest().toHex().toUpperCase().replace(/(.{2})/g, '$1:').slice(0, -1);
            return {
                domain: cert.subject.getField('CN')?.value || 'unknown',
                notBefore: cert.validity.notBefore,
                notAfter: cert.validity.notAfter,
                issuer: cert.issuer.getField('CN')?.value || 'unknown',
                subject: cert.subject.getField('CN')?.value || 'unknown',
                fingerprint,
                serialNumber: cert.serialNumber,
                keyType: 'RSA', // Simplified for now
                keySize: 2048, // Default, would need more complex parsing for actual size
                subjectAlternativeNames,
                isValid: now < cert.validity.notAfter && now > cert.validity.notBefore,
                expiresIn
            };
        }
        catch (error) {
            this.logger.error(`Failed to parse certificate ${certificatePath}:`, error);
            return null;
        }
    }
    /**
     * Initiate certificate renewal
     */
    async renewCertificate(domain: string): Promise<void> {
        try {
            this.logger.log(`Initiating certificate renewal for: ${domain}`);
            // Update certificate record
            await this.sslCertificateRepository.updateCertificate(domain, {
                renewalStatus: 'pending'
            });
            // Queue renewal job with high priority
            await this.deploymentQueue.add('renew-certificate', {
                domain
            }, {
                priority: 1, // High priority
                attempts: 5,
                delay: 5000,
                backoff: {
                    type: 'exponential',
                    delay: 10000
                }
            });
            this.logger.log(`Certificate renewal queued for: ${domain}`);
        }
        catch (error) {
            this.logger.error(`Failed to initiate certificate renewal for ${domain}:`, error);
            throw error;
        }
    }
    /**
     * Handle certificate renewal failure
     */
    async handleRenewalFailure(domain: string, error: string): Promise<void> {
        try {
            this.logger.error(`Certificate renewal failed for ${domain}: ${error}`);
            await this.sslCertificateRepository.updateCertificate(domain, {
                renewalStatus: 'failed',
                errorMessage: error
            });
            // Send alert (could integrate with notification service)
            this.logger.error(`ALERT: Certificate renewal failed for ${domain}. Manual intervention required.`);
        }
        catch (dbError) {
            this.logger.error(`Failed to update renewal failure status for ${domain}:`, dbError);
        }
    }
    /**
     * Get certificate status
     */
    async getCertificateStatus(domain: string): Promise<any> {
        try {
            const certificate = await this.sslCertificateRepository.findByDomain(domain);
            if (!certificate) {
                return null;
            }
            // Parse certificate file for real-time information
            const certInfo = await this.parseCertificateFile(certificate.certificatePath);
            return {
                ...certificate,
                realTimeCertInfo: certInfo
            };
        }
        catch (error) {
            this.logger.error(`Failed to get certificate status for ${domain}:`, error);
            throw error;
        }
    }
    /**
     * Create SSL certificate record
     */
    async createCertificateRecord(config: {
        domain: string;
        projectId: string;
        issuer: string;
        autoRenew: boolean;
    }): Promise<void> {
        try {
            // Check if certificate record exists
            await this.sslCertificateRepository.findByDomainOrCreate(config.domain, {
                projectId: config.projectId,
                issuer: config.issuer,
                autoRenew: config.autoRenew,
                isValid: false, // Will be updated when certificate is issued
                certificatePath: `/certificates/${config.domain}.crt`,
                privateKeyPath: `/certificates/${config.domain}.key`,
                renewalStatus: 'pending',
                metadata: {
                    subjectAlternativeNames: [config.domain],
                    keyType: 'RSA',
                    keySize: 2048,
                    fingerprint: '',
                    serialNumber: ''
                }
            });
            this.logger.log(`SSL certificate record created: ${config.domain}`);
        }
        catch (error) {
            this.logger.error(`Failed to create SSL certificate record for ${config.domain}:`, error);
            throw error;
        }
    }
    /**
     * Get certificates expiring soon
     */
    async getCertificatesExpiringSoon(days: number = 30): Promise<any[]> {
        try {
            const expiringCertificates = await this.sslCertificateRepository.findExpiringCertificatesForNotification(days);
            return expiringCertificates.map(cert => {
                const expiresIn = cert.expiresAt ?
                    Math.ceil((new Date(cert.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) :
                    null;
                return {
                    ...cert,
                    expiresInDays: expiresIn
                };
            });
        }
        catch (error) {
            this.logger.error(`Failed to get expiring certificates:`, error);
            throw error;
        }
    }
    /**
     * Remove certificate record
     */
    async removeCertificateRecord(domain: string): Promise<void> {
        try {
            await this.sslCertificateRepository.markAsRenewing(domain);
            this.logger.log(`SSL certificate record deactivated: ${domain}`);
        }
        catch (error) {
            this.logger.error(`Failed to remove SSL certificate record for ${domain}:`, error);
            throw error;
        }
    }
}
