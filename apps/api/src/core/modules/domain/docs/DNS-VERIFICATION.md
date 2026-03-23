# DNS Verification

> **Last Updated**: 2025-11-30

## Overview

Before a domain or subdomain can be used in the platform, ownership must be verified via DNS records. This prevents domain hijacking and ensures only legitimate owners can use domains.

**Important**: Organizations can register either:
- **Root domains**: `example.com`
- **Subdomains**: `api.example.com`, `team.api.example.com`, etc.

This allows multiple organizations to collaborate on shared domains by registering different subdomains.

## Verification Methods

### TXT Record Verification (Recommended)

**How it works**: User adds a TXT record with a verification token that includes the registered domain/subdomain for uniqueness.

**Token Format**: `deployer-verify-{random}-{registered_domain_hash}`

The token is suffixed with a hash of the registered domain to ensure verification is domain-specific.

**For root domain registration** (`example.com`):
```
Record Type: TXT
Name: _deployer-verify.example.com
Value: deployer-verify-a1b2c3d4e5f6-example.com
TTL: 3600 (or minimum allowed)
```

**For subdomain registration** (`api.example.com`):
```
Record Type: TXT
Name: _deployer-verify.api.example.com
Value: deployer-verify-a1b2c3d4e5f6-api.example.com
TTL: 3600 (or minimum allowed)
```

**For nested subdomain registration** (`team.api.example.com`):
```
Record Type: TXT
Name: _deployer-verify.team.api.example.com
Value: deployer-verify-a1b2c3d4e5f6-team.api.example.com
TTL: 3600 (or minimum allowed)
```

**Advantages**:
- ✅ Doesn't affect existing DNS configuration
- ✅ Works with any DNS provider
- ✅ No impact on live services
- ✅ Simple to implement and verify

**Verification Code**:

```typescript
private async verifyTxtRecord(recordName: string, expectedToken: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(recordName);
    
    for (const record of records) {
      // TXT records are returned as arrays of strings
      const value = Array.isArray(record) ? record.join('') : record;
      if (value === expectedToken) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    this.logger.debug(`TXT record lookup failed for ${recordName}`);
    return false;
  }
}
```

### CNAME Record Verification

**How it works**: User adds a CNAME record pointing to a verification endpoint that includes the registered domain.

**For root domain registration** (`example.com`):
```
Record Type: CNAME
Name: _deployer-verify.example.com
Value: verify-a1b2c3d4e5f6-example.com.deployer.io
TTL: 3600 (or minimum allowed)
```

**For subdomain registration** (`api.example.com`):
```
Record Type: CNAME
Name: _deployer-verify.api.example.com
Value: verify-a1b2c3d4e5f6-api.example.com.deployer.io
TTL: 3600 (or minimum allowed)
```

**Advantages**:
- ✅ Alternative for providers with TXT limitations
- ✅ Can be used for additional validation

**Disadvantages**:
- ❌ Slightly more complex setup
- ❌ Requires deployer.io DNS infrastructure

**Verification Code**:

```typescript
private async verifyCnameRecord(recordName: string, expectedToken: string): Promise<boolean> {
  try {
    const records = await dns.resolveCname(recordName);
    const expectedValue = `verify-${expectedToken}.deployer.io`;
    
    return records.some(record => record === expectedValue);
  } catch (error) {
    this.logger.debug(`CNAME record lookup failed for ${recordName}`);
    return false;
  }
}
```

## Token Generation

Verification tokens are cryptographically secure random values **suffixed with the registered domain** for uniqueness:

```typescript
generateVerificationToken(registeredDomain: string): string {
  // 16 bytes = 32 hex characters of randomness + domain suffix
  const randomPart = randomBytes(16).toString('hex');
  return `deployer-verify-${randomPart}-${registeredDomain}`;
}

// Examples:
// Root domain: "deployer-verify-a1b2c3d4e5f67890-example.com"
// Subdomain: "deployer-verify-a1b2c3d4e5f67890-api.example.com"
// Nested: "deployer-verify-a1b2c3d4e5f67890-team.api.example.com"
```

**Why include the domain in the token?**
- Ensures verification is specific to the exact domain being registered
- Prevents token reuse across different domain registrations
- Makes audit logs more readable
- Simplifies debugging verification issues

## Verification Flow

### Registration Phase

```
┌──────────┐     1. Register Domain      ┌──────────────────┐
│  Client  │ ──────────────────────────> │ OrganizationCtrl │
└──────────┘                             └────────┬─────────┘
                                                  │
                 2. Generate Token                ▼
              ┌─────────────────────────────────────────────────┐
              │        DomainVerificationService               │
              │  token = generateVerificationToken()           │
              │  instructions = getVerificationInstructions()  │
              └─────────────────────────────────────────────────┘
                                                  │
                 3. Save to Database              ▼
              ┌─────────────────────────────────────────────────┐
              │        OrganizationDomainRepository            │
              │  domain.verificationToken = token              │
              │  domain.verificationStatus = 'pending'         │
              └─────────────────────────────────────────────────┘
                                                  │
                 4. Return Instructions           ▼
              ┌─────────────────────────────────────────────────┐
              │        Response to Client                       │
              │  - Domain ID                                    │
              │  - Verification Instructions                    │
              │  - DNS record details                           │
              └─────────────────────────────────────────────────┘
```

### Verification Phase

```
┌──────────┐    1. User Adds DNS Record    ┌─────────────────┐
│   User   │ ────────────────────────────> │   DNS Provider  │
└──────────┘                               └─────────────────┘
     │
     │  2. Trigger Verification
     ▼
┌──────────┐                              ┌──────────────────┐
│  Client  │ ───────────────────────────> │ OrganizationCtrl │
└──────────┘                              └────────┬─────────┘
                                                   │
                 3. Fetch Domain                   ▼
              ┌──────────────────────────────────────────────────┐
              │        OrganizationDomainRepository             │
              │  domain = findById(domainId)                    │
              │  token = domain.verificationToken               │
              └──────────────────────────────────────────────────┘
                                                   │
                 4. Query DNS                      ▼
              ┌──────────────────────────────────────────────────┐
              │        DomainVerificationService                │
              │  dns.resolveTxt('_deployer-verify.example.com') │
              │  compare(actualValue, expectedToken)            │
              └──────────────────────────────────────────────────┘
                                                   │
              ┌───────────────┬───────────────────┘
              ▼               ▼
        ┌──────────┐    ┌──────────┐
        │  Match   │    │ No Match │
        └────┬─────┘    └────┬─────┘
             │               │
             ▼               ▼
        ┌──────────┐    ┌──────────┐
        │ VERIFIED │    │  FAILED  │
        └──────────┘    └──────────┘
```

## API Reference

### Get Verification Instructions

```typescript
getVerificationInstructions(
  domain: string,
  token: string,
  method: 'txt_record' | 'cname_record'
): VerificationInstructions

interface VerificationInstructions {
  method: 'txt_record' | 'cname_record';
  recordName: string;       // "_deployer-verify.example.com"
  recordValue: string;      // Token or CNAME target
  instructions: string;     // Human-readable instructions
}
```

**Example Response (TXT)**:

```json
{
  "method": "txt_record",
  "recordName": "_deployer-verify.example.com",
  "recordValue": "deployer-verify-a1b2c3d4e5f6...",
  "instructions": "Add the following TXT record to your DNS configuration:\n\nRecord Type: TXT\nName: _deployer-verify.example.com\nValue: deployer-verify-a1b2c3d4e5f6...\nTTL: 3600 (or minimum allowed)\n\nThe verification will be checked automatically within an hour, or you can trigger manual verification."
}
```

### Verify Domain

```typescript
verifyDomain(domainId: string): Promise<VerifyDomainResult>

interface VerifyDomainResult {
  success: boolean;
  status: 'verified' | 'failed';
  message: string;
  verifiedAt?: Date;
  error?: {
    code: string;
    details: string;
  };
}
```

**Success Response**:

```json
{
  "success": true,
  "status": "verified",
  "message": "Domain verified successfully",
  "verifiedAt": "2025-11-30T10:30:00.000Z"
}
```

**Failure Response**:

```json
{
  "success": false,
  "status": "failed",
  "message": "DNS record not found or token mismatch",
  "error": {
    "code": "DNS_VERIFICATION_FAILED",
    "details": "Please check your DNS configuration and try again. DNS changes can take up to 48 hours to propagate."
  }
}
```

## Auto-Verification

The system includes automatic verification for pending domains:

```typescript
// Runs every hour (when @nestjs/schedule is enabled)
@Cron(CronExpression.EVERY_HOUR)
async autoVerifyPendingDomains() {
  // Get all pending domains
  const pendingDomains = await this.organizationDomainService.findPendingDomains();
  
  for (const domain of pendingDomains) {
    const result = await this.verifyDomain(domain.id);
    
    if (result.success) {
      this.logger.log(`Auto-verified domain: ${domain.domain}`);
    }
  }
}
```

**Enable Auto-Verification**:

1. Install `@nestjs/schedule`:
   ```bash
   npm install @nestjs/schedule
   ```

2. Update `DomainModule`:
   ```typescript
   import { ScheduleModule } from '@nestjs/schedule';

   @Module({
     imports: [
       ScheduleModule.forRoot(),
       // ...
     ],
   })
   export class DomainModule {}
   ```

3. Uncomment the `@Cron` decorator in `DomainVerificationService`.

## DNS Provider Examples

### Cloudflare

```
Type: TXT
Name: _deployer-verify
Content: deployer-verify-a1b2c3d4...
TTL: Auto
```

### AWS Route 53

```
Record name: _deployer-verify.example.com
Record type: TXT
Value: "deployer-verify-a1b2c3d4..."
TTL: 300
```

### GoDaddy

```
Type: TXT
Host: _deployer-verify
TXT Value: deployer-verify-a1b2c3d4...
TTL: 1 hour
```

### Google Domains

```
Host name: _deployer-verify
Type: TXT
TTL: 3600
Data: deployer-verify-a1b2c3d4...
```

### Namecheap

```
Type: TXT Record
Host: _deployer-verify
Value: deployer-verify-a1b2c3d4...
TTL: Automatic
```

## Troubleshooting

### Common Issues

#### 1. "DNS record not found"

**Causes**:
- DNS propagation not complete (can take up to 48 hours)
- Record added to wrong domain
- Record name has wrong prefix

**Solutions**:
- Wait for DNS propagation
- Verify record using: `dig TXT _deployer-verify.example.com`
- Check DNS provider dashboard

#### 2. "Token mismatch"

**Causes**:
- Copied token incorrectly
- Trailing/leading spaces in DNS record
- Token truncated

**Solutions**:
- Re-copy the exact token value
- Remove any extra spaces
- Ensure full token is included

#### 3. "Already verified"

**Cause**: Domain was already verified

**Solution**: No action needed, proceed to use the domain

#### 4. "Domain not found"

**Cause**: Invalid domain ID

**Solution**: Check the domain ID is correct

### Debug Commands

```bash
# Check TXT record
dig TXT _deployer-verify.example.com +short

# Check with specific DNS server (bypass caching)
dig TXT _deployer-verify.example.com @8.8.8.8 +short

# Check CNAME record
dig CNAME _deployer-verify.example.com +short

# Check DNS propagation status
# Use: https://www.whatsmydns.net/
```

## Security Considerations

### 1. Token Security

- Tokens are cryptographically random (128 bits of entropy)
- Tokens are not exposed after initial creation
- Failed verifications don't leak token information

### 2. Rate Limiting

Manual verification should be rate-limited to prevent DNS enumeration:

```typescript
@Throttle({ default: { limit: 5, ttl: 60000 } })
async verifyOrganizationDomain() {
  // ...
}
```

### 3. Token Rotation

If a token is compromised:

```typescript
// Delete and re-register domain
await orgDomainRepository.delete(domainId);

// User registers again with new token
await orgDomainController.addOrganizationDomain({
  organizationId,
  domain,
  verificationMethod: 'txt_record',
});
```

### 4. Verification Expiry

Consider adding token expiry for long-pending verifications:

```typescript
// Future enhancement
if (domain.createdAt < thirtyDaysAgo) {
  // Regenerate token or require re-registration
}
```

## Best Practices

### 1. Use TXT Records by Default

```typescript
// ✅ Recommended
verificationMethod: 'txt_record'

// ⚠️ Use only if TXT not supported
verificationMethod: 'cname_record'
```

### 2. Provide Clear Instructions

```typescript
// Include in response
{
  "verificationInstructions": {
    "method": "txt_record",
    "recordName": "_deployer-verify.example.com",
    "recordValue": "deployer-verify-...",
    "instructions": "Step-by-step guide..."
  }
}
```

### 3. Implement Retry Logic

```typescript
async retryVerification(domainId: string): Promise<VerifyDomainResult> {
  // Reset status to pending
  await this.organizationDomainService.update(domainId, {
    verificationStatus: 'pending',
  });

  // Attempt verification again
  return await this.verifyDomain(domainId);
}
```

### 4. Notify on Success

```typescript
// Future enhancement: Send email notification
async notifyVerificationSuccess(domain: OrganizationDomain) {
  await this.emailService.send({
    to: organizationAdminEmail,
    subject: `Domain ${domain.domain} verified`,
    template: 'domain-verified',
    data: { domain: domain.domain },
  });
}
```
