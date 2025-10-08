# GitHub Provider Multi-Tenant Implementation Summary

## Overview

This document summarizes the changes made to support multi-tenant GitHub App architecture where each organization can have its own GitHub App with unique credentials stored in the database.

## Architecture Change

### Before (Environment-Based)
- Single GitHub App configured via environment variables
- All organizations use the same app credentials
- Credentials stored in `.env` file
- Limited to one GitHub App per deployment

### After (Database-Based)
- Multiple GitHub Apps supported
- Each organization can have unique credentials
- Credentials stored securely in database per installation
- True multi-tenant SaaS architecture
- Environment variables only used as fallback/defaults

## Database Schema Changes

Added to `githubInstallations` table in `/home/sebille/Bureau/projects/tests/deployer/apps/api/src/config/drizzle/schema/deployment.ts`:

```typescript
// New fields (lines 421-426)
appId: text("app_id")                     // GitHub App ID
privateKey: text("private_key")            // Private key (TODO: encrypt in production)
clientId: text("client_id")                // OAuth client ID  
clientSecret: text("client_secret")        // OAuth secret (TODO: encrypt in production)
webhookSecret: text("webhook_secret")      // Per-app webhook secret
```

**Security Note**: `privateKey` and `clientSecret` should be encrypted at rest in production.

## Service Updates

### 1. GitHubService (`src/core/modules/github/services/github.service.ts`)

**Changes:**
- Updated constructor to not require GitHub App credentials from environment
- Modified `verifyWebhookSignature()` to accept optional `webhookSecret` parameter
- Maintains Map-based caching of App instances per organization
- Loads credentials from database when registering installations

**Key Methods:**
```typescript
// Updated signature
async verifyWebhookSignature(
  payload: string, 
  signature: string, 
  webhookSecret?: string  // NEW: optional per-installation secret
): Promise<boolean>
```

### 2. GitHubProviderService (`src/core/modules/github/services/github-provider.service.ts`)

**Updated Methods:**

```typescript
// Added credential fields to createInstallation
async createInstallation(data: {
  installationId: number
  organizationLogin: string
  userId: string
  appId?: string              // NEW
  privateKey?: string          // NEW
  clientId?: string            // NEW
  clientSecret?: string        // NEW
  webhookSecret?: string       // NEW
}): Promise<string>

// Updated storeInstallation to handle credentials
async storeInstallation(data: Partial<InsertGithubInstallation> & {
  installationId: number
  organizationLogin: string
  userId: string
}): Promise<string>

// Simplified updateInstallation signature
async updateInstallation(data: Partial<SelectGithubInstallation> & { 
  id: string
}): Promise<void>
```

## OAuth Flow (NEW Implementation Needed)

### Current Status: ❌ NOT IMPLEMENTED
The OAuth controller needs to be completely rewritten to support database-first credentials.

### Recommended Flow:

1. **POST `/github/installations/setup`** - User provides GitHub App credentials
   ```json
   {
     "appId": "123456",
     "appSlug": "my-deployer-app",
     "privateKey": "-----BEGIN RSA PRIVATE KEY-----...",
     "clientId": "Iv1.abc123",
     "clientSecret": "secret123",
     "webhookSecret": "webhook_secret"
   }
   ```

2. **GET `/github/install/:appSlug?appId=123&credentials=base64`** - Redirect to GitHub
   - Encodes credentials in state parameter (encrypted in production)
   - Redirects to `https://github.com/apps/:appSlug/installations/new`

3. **GET `/github/callback?installation_id=456&state=...`** - GitHub callback
   - Decodes credentials from state parameter
   - Fetches installation details from GitHub API
   - Stores installation + credentials in database
   - Registers in GitHubService
   - Syncs repositories
   - Redirects to dashboard

4. **GET `/github/installations`** - List all installations (with credentials check)

5. **GET `/github/installations/:orgLogin/sync`** - Sync repositories

### Security Considerations:

- **Credentials Transmission**: Use encrypted state parameter or session storage
- **Credentials Storage**: Encrypt `privateKey` and `clientSecret` at rest
- **Credentials Access**: Implement proper authorization checks
- **Audit Logging**: Track all credential access and modifications
- **Rotation Support**: Add endpoints for credential rotation

## Migration Required

### Step 1: Generate Database Migration
```bash
bun run api -- db:generate
```

This will create a migration file for the new credential fields.

### Step 2: Run Migration
```bash
bun run api -- db:migrate
```

### Step 3: Update Existing Installations (if any)
If you have existing installations, you'll need to manually add credentials to the database:

```sql
UPDATE github_installations
SET 
  app_id = 'your-app-id',
  private_key = 'your-private-key',
  client_id = 'your-client-id',
  client_secret = 'your-client-secret',
  webhook_secret = 'your-webhook-secret'
WHERE id = 'installation-id';
```

## Webhook Handler Updates Needed

The webhook controller needs to load credentials from database for signature verification:

```typescript
// In github-webhook.controller.ts

@Post('webhook')
async handleWebhook(@Body() payload, @Headers('x-hub-signature-256') signature) {
  // Extract organization from payload
  const organizationLogin = payload.installation.account.login
  
  // Load installation from database
  const installation = await this.githubProviderService
    .getInstallationByOrganization(organizationLogin)
  
  // Verify signature using installation's webhook secret
  const isValid = await this.githubService.verifyWebhookSignature(
    JSON.stringify(payload),
    signature,
    installation?.webhookSecret  // Use per-installation secret
  )
  
  // ...rest of handler
}
```

## TODO List

### High Priority
- [ ] Complete OAuth controller implementation with database-first approach
- [ ] Implement credential encryption/decryption service
- [ ] Update webhook handler to use installation-specific webhook secrets
- [ ] Generate and run database migration
- [ ] Add API endpoints for credential management (update, rotate, delete)

### Medium Priority
- [ ] Create frontend UI for GitHub App setup wizard
- [ ] Add user authentication integration (replace 'system' userId)
- [ ] Implement audit logging for credential access
- [ ] Add credential validation and format checking
- [ ] Support credential rotation without downtime

### Low Priority
- [ ] Add support for GitHub App webhooks configuration
- [ ] Implement automatic credential rotation
- [ ] Add monitoring for credential expiration
- [ ] Create admin interface for managing all installations

## Testing Strategy

### Unit Tests
- [ ] Test credential storage and retrieval
- [ ] Test OAuth flow with mocked GitHub API
- [ ] Test webhook signature verification with custom secrets
- [ ] Test multi-tenant isolation (org A cannot access org B's credentials)

### Integration Tests
- [ ] Test complete installation flow end-to-end
- [ ] Test repository synchronization
- [ ] Test webhook delivery with different installations
- [ ] Test credential updates don't break existing installations

### Security Tests
- [ ] Verify credentials are encrypted at rest
- [ ] Test authorization (users can only access their installations)
- [ ] Verify no credential leakage in API responses
- [ ] Test rate limiting on sensitive endpoints

## Breaking Changes

### For Existing Deployments
1. Database schema must be migrated to add credential fields
2. Existing installations need credentials added manually
3. Environment variables are no longer required (but can be used as fallback)
4. OAuth flow is completely different (requires credentials input)

### API Changes
- New endpoint: `POST /github/installations/setup`
- Modified endpoint: `GET /github/install/:appSlug` (was `/github/install/:organizationLogin`)
- Modified response: `GET /github/installations` now includes `hasCredentials` flag

## References

- **Database Schema**: `apps/api/src/config/drizzle/schema/deployment.ts`
- **GitHub Service**: `apps/api/src/core/modules/github/services/github.service.ts`
- **Provider Service**: `apps/api/src/core/modules/github/services/github-provider.service.ts`
- **Module Definition**: `apps/api/src/core/modules/github/github.module.ts`
- **Webhook Controller**: `apps/api/src/core/modules/github/controllers/github-webhook.controller.ts`

## Architecture Benefits

1. **True Multi-Tenancy**: Each organization fully isolated with own credentials
2. **Scalability**: Support unlimited GitHub Apps across different organizations
3. **Security**: Credentials encrypted and isolated per installation
4. **Flexibility**: Organizations can use their own GitHub Apps
5. **Self-Service**: Users can set up their own integrations without admin intervention

## Next Steps

The immediate next action is to implement the OAuth controller with proper database-first credential handling as outlined in the "Recommended Flow" section above.
