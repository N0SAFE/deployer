import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import * as dns from 'dns';

export interface DNSRecord {
  type: string;
  value: string;
  ttl?: number;
}

export interface DNSCheckResult {
  domain: string;
  status: 'valid' | 'invalid' | 'error';
  records: DNSRecord[];
  errorMessage: string | null;
  checkedAt: Date;
}

@Injectable()
export class DNSService {
  private readonly logger = new Logger(DNSService.name);
  private readonly lookup = promisify(dns.lookup);
  private readonly resolve4 = promisify(dns.resolve4);
  private readonly resolve6 = promisify(dns.resolve6);
  private readonly resolveCname = promisify(dns.resolveCname);
  private readonly resolveMx = promisify(dns.resolveMx);
  private readonly resolveTxt = promisify(dns.resolveTxt);
  private readonly resolveNs = promisify(dns.resolveNs);

  /**
   * Check DNS records for a domain
   */
  async checkDNS(domain: string, recordType: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' = 'A'): Promise<DNSCheckResult> {
    const checkedAt = new Date();
    
    try {
      this.logger.log(`Checking DNS for ${domain} (${recordType})`);
      
      let records: DNSRecord[] = [];
      let status: 'valid' | 'invalid' | 'error' = 'valid';
      let errorMessage: string | null = null;

      switch (recordType) {
        case 'A':
          try {
            const addresses = await this.resolve4(domain);
            records = addresses.map(addr => ({ type: 'A', value: addr }));
          } catch (error) {
            // Fallback to basic lookup
            try {
              const result = await this.lookup(domain, { family: 4 });
              records = [{ type: 'A', value: result.address }];
            } catch {
              throw error; // Use original error
            }
          }
          break;
          
        case 'AAAA':
          const ipv6Addresses = await this.resolve6(domain);
          records = ipv6Addresses.map(addr => ({ type: 'AAAA', value: addr }));
          break;
          
        case 'CNAME':
          const cnameRecords = await this.resolveCname(domain);
          records = cnameRecords.map(cname => ({ type: 'CNAME', value: cname }));
          break;
          
        case 'MX':
          const mxRecords = await this.resolveMx(domain);
          records = mxRecords.map(mx => ({ 
            type: 'MX', 
            value: `${mx.priority} ${mx.exchange}` 
          }));
          break;
          
        case 'TXT':
          const txtRecords = await this.resolveTxt(domain);
          records = txtRecords.map(txt => ({ 
            type: 'TXT', 
            value: Array.isArray(txt) ? txt.join('') : txt 
          }));
          break;
          
        case 'NS':
          const nsRecords = await this.resolveNs(domain);
          records = nsRecords.map(ns => ({ type: 'NS', value: ns }));
          break;
          
        default:
          throw new Error(`Unsupported record type: ${recordType}`);
      }

      if (records.length === 0) {
        status = 'invalid';
        errorMessage = `No ${recordType} records found for ${domain}`;
      }

      this.logger.log(`DNS check for ${domain} completed: ${records.length} ${recordType} records found`);
      
      return {
        domain,
        status,
        records,
        errorMessage,
        checkedAt,
      };
      
    } catch (error) {
      this.logger.error(`DNS check failed for ${domain}:`, error);
      
      return {
        domain,
        status: 'error',
        records: [],
        errorMessage: error instanceof Error ? error.message : 'Unknown DNS error',
        checkedAt,
      };
    }
  }

  /**
   * Check if a domain resolves to any valid IP address
   */
  async isDomainResolvable(domain: string): Promise<boolean> {
    try {
      const result = await this.checkDNS(domain, 'A');
      return result.status === 'valid' && result.records.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get all DNS record types for a domain
   */
  async getAllDNSRecords(domain: string): Promise<DNSCheckResult[]> {
    const recordTypes: Array<'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS'> = 
      ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
    
    const results = await Promise.allSettled(
      recordTypes.map(type => this.checkDNS(domain, type))
    );

    return results
      .filter((result): result is PromiseFulfilledResult<DNSCheckResult> => 
        result.status === 'fulfilled')
      .map(result => result.value)
      .filter(result => result.status !== 'error' || result.records.length > 0);
  }
}