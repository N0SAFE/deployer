# Database-Level Encryption

This document explains how automatic encryption/decryption works at the database level using custom Drizzle column types.

## Overview

Sensitive data like GitHub App private keys, OAuth client secrets, and webhook secrets are automatically encrypted when stored in the database and automatically decrypted when retrieved. This happens transparently at the Drizzle ORM level, so application code works with plain text values without any encryption logic.

## Architecture

### Custom Column Type: `encryptedText`

The `encryptedText` custom Drizzle column type provides:
- **Automatic Encryption**: Plain text → Encrypted text when writing to database
- **Automatic Decryption**: Encrypted text → Plain text when reading from database
- **Transparent to Application**: Code works with plain text, encryption is invisible

### Encryption Algorithm

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Size**: 256 bits (32 bytes)
- **IV**: Randomly generated per encryption (16 bytes)
- **Salt**: Randomly generated per encryption (32 bytes)
- **Authentication Tag**: GCM provides authenticated encryption (16 bytes)

### Encrypted Data Format

Encrypted values are stored as hex-encoded strings with the format:
```
salt:iv:authTag:encryptedData
```

Example:
```
a1b2c3...:d4e5f6...:g7h8i9...:j0k1l2...
```

Each component is essential for decryption:
- **Salt**: Used to derive a unique encryption key
- **IV**: Initialization Vector for the cipher
- **Auth Tag**: Ensures data integrity (detects tampering)
- **Encrypted Data**: The actual encrypted content

## Setup

### 1. Generate Encryption Key

Generate a secure 256-bit encryption key:

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Or using the utility function
bun run api -- node -e "const { generateEncryptionKey } = require('./src/config/drizzle/custom-types/encrypted-text'); console.log(generateEncryptionKey())"
```

**Output example:**
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

### 2. Configure Environment Variable

Add the generated key to your `.env` file:

```env
# Encryption key for sensitive database fields (32 bytes / 256 bits in hex)
ENCRYPTION_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

**⚠️ CRITICAL SECURITY NOTES:**
- **Never commit the encryption key to version control**
- **Use different keys for development, staging, and production**
- **Store production keys in secure secret management systems** (e.g., AWS Secrets Manager, HashiCorp Vault, Azure Key Vault)
- **Rotate keys periodically** (see Key Rotation section below)

### 3. Database Migration

After updating the schema to use `encryptedText`, generate and run migrations:

```bash
# Generate migration
bun run api -- db:generate

# Review the generated migration in apps/api/drizzle/migrations/

# Apply migration (this will NOT encrypt existing data - see Migration section)
bun run api -- db:push
```

## Usage in Schema

### Basic Usage

```typescript
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "../custom-types/encrypted-text";

export const myTable = pgTable("my_table", {
  id: uuid("id").primaryKey(),
  publicField: text("public_field"), // Not encrypted
  secretField: encryptedText("secret_field"), // Automatically encrypted
  optionalSecret: encryptedText("optional_secret"), // Nullable encrypted field
});
```

### GitHub Installations Example

```typescript
export const githubInstallations = pgTable("github_installations", {
  id: uuid("id").primaryKey(),
  accountLogin: text("account_login").notNull(),
  
  // Public identifiers (not encrypted)
  appId: text("app_id"),
  clientId: text("client_id"),
  
  // Sensitive credentials (automatically encrypted)
  privateKey: encryptedText("private_key"),
  clientSecret: encryptedText("client_secret"),
  webhookSecret: encryptedText("webhook_secret"),
});
```

## Application Code

Application code works with **plain text values** - encryption is transparent:

### Inserting Data

```typescript
// Write plain text - automatically encrypted in database
await db.insert(githubInstallations).values({
  id: crypto.randomUUID(),
  accountLogin: "myorg",
  appId: "123456",
  clientId: "Iv1.a1b2c3d4e5f6g7h8",
  
  // These are automatically encrypted before storage
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\n...",
  clientSecret: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  webhookSecret: "my-webhook-secret-key",
});
```

### Querying Data

```typescript
// Read plain text - automatically decrypted from database
const installation = await db
  .select()
  .from(githubInstallations)
  .where(eq(githubInstallations.accountLogin, "myorg"))
  .limit(1);

// These values are automatically decrypted plain text
console.log(installation.privateKey); // "-----BEGIN RSA PRIVATE KEY-----\n..."
console.log(installation.clientSecret); // "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
console.log(installation.webhookSecret); // "my-webhook-secret-key"
```

### Updating Data

```typescript
// Update with plain text - automatically encrypted
await db
  .update(githubInstallations)
  .set({
    webhookSecret: "new-webhook-secret", // Automatically encrypted
  })
  .where(eq(githubInstallations.id, installationId));
```

## Migrating Existing Data

If you have existing unencrypted data that needs to be encrypted:

### Option 1: Migration Script (Recommended)

Create a migration script to encrypt existing data:

```typescript
// apps/api/src/scripts/encrypt-existing-data.ts
import { db } from "../config/database";
import { githubInstallations } from "../config/drizzle/schema/deployment";
import { encrypt } from "../config/drizzle/custom-types/encrypted-text";

async function encryptExistingData() {
  console.log("Starting data encryption...");
  
  // Fetch all records with unencrypted data
  const installations = await db
    .select()
    .from(githubInstallations)
    .execute();
  
  console.log(`Found ${installations.length} installations to process`);
  
  for (const installation of installations) {
    try {
      // Check if data is already encrypted (has salt:iv:authTag:data format)
      const isAlreadyEncrypted = 
        installation.privateKey?.includes(":") &&
        installation.privateKey.split(":").length === 4;
      
      if (!isAlreadyEncrypted && installation.privateKey) {
        // Data is plain text, needs encryption
        // When we update, Drizzle will automatically encrypt it
        await db
          .update(githubInstallations)
          .set({
            // Just set the same values - Drizzle will encrypt them
            privateKey: installation.privateKey,
            clientSecret: installation.clientSecret,
            webhookSecret: installation.webhookSecret,
          })
          .where(eq(githubInstallations.id, installation.id));
        
        console.log(`✓ Encrypted installation ${installation.accountLogin}`);
      } else {
        console.log(`⊘ Skipped installation ${installation.accountLogin} (already encrypted)`);
      }
    } catch (error) {
      console.error(`✗ Failed to encrypt installation ${installation.accountLogin}:`, error);
    }
  }
  
  console.log("Data encryption complete!");
}

encryptExistingData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
```

Run the script:
```bash
bun run apps/api/src/scripts/encrypt-existing-data.ts
```

### Option 2: Manual SQL (Advanced)

For large datasets, you might want to handle encryption at the SQL level. However, this is complex because you need to replicate the encryption logic in SQL or use a function.

**Not recommended** - use the migration script instead.

## Key Rotation

When rotating encryption keys (changing `ENCRYPTION_KEY`):

### 1. Generate New Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Create Key Rotation Script

```typescript
// apps/api/src/scripts/rotate-encryption-key.ts
import { db } from "../config/database";
import { githubInstallations } from "../config/drizzle/schema/deployment";
import { decrypt as decryptOld } from "../config/drizzle/custom-types/encrypted-text";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Old key (from current ENCRYPTION_KEY)
const OLD_KEY = Buffer.from(process.env.OLD_ENCRYPTION_KEY!, "hex");

// New key (from new encryption key)
const NEW_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");

// Implement decryption with old key and encryption with new key
async function rotateKey() {
  const installations = await db.select().from(githubInstallations);
  
  for (const installation of installations) {
    // Decrypt with old key
    const decryptedPrivateKey = decryptWithKey(installation.privateKey, OLD_KEY);
    const decryptedClientSecret = decryptWithKey(installation.clientSecret, OLD_KEY);
    const decryptedWebhookSecret = decryptWithKey(installation.webhookSecret, OLD_KEY);
    
    // Update (will encrypt with new key automatically)
    await db
      .update(githubInstallations)
      .set({
        privateKey: decryptedPrivateKey,
        clientSecret: decryptedClientSecret,
        webhookSecret: decryptedWebhookSecret,
      })
      .where(eq(githubInstallations.id, installation.id));
  }
}
```

### 3. Execute Rotation

```bash
# Set both keys
OLD_ENCRYPTION_KEY=old_key_here ENCRYPTION_KEY=new_key_here bun run apps/api/src/scripts/rotate-encryption-key.ts
```

## Security Considerations

### ✅ What This Provides

- **Encryption at Rest**: Data is encrypted in the database
- **Automatic Encryption**: No manual encryption code needed
- **Key Derivation**: Each encrypted value uses a unique derived key
- **Authentication**: GCM mode provides integrity checking
- **Salt + IV**: Random salt and IV prevent pattern analysis

### ⚠️ What This Does NOT Provide

- **Encryption in Transit**: Use TLS/SSL for network encryption
- **Encryption in Memory**: Data is decrypted in application memory
- **Access Control**: Implement proper authentication/authorization
- **Key Management**: Use a proper secrets management system for production
- **Audit Logging**: Log access to sensitive data separately

### Best Practices

1. **Use a Secrets Manager in Production**:
   - AWS Secrets Manager
   - HashiCorp Vault
   - Azure Key Vault
   - Google Secret Manager

2. **Implement Key Rotation**:
   - Rotate encryption keys every 90-180 days
   - Maintain old keys until all data is re-encrypted

3. **Restrict Database Access**:
   - Use least-privilege database users
   - Enable database audit logging
   - Monitor access to sensitive tables

4. **Separate Environments**:
   - Use different keys for dev, staging, production
   - Never use production keys in development

5. **Backup Encryption Keys Securely**:
   - Store backup keys in a secure offline location
   - Without the key, encrypted data cannot be recovered

6. **Monitor for Breaches**:
   - Monitor for unusual database access patterns
   - Set up alerts for mass data exports
   - Implement rate limiting on sensitive endpoints

## Performance Considerations

### Encryption Overhead

- **CPU**: Minimal overhead (~1-5ms per field)
- **Storage**: ~50-100 bytes overhead per encrypted field (salt + IV + auth tag)
- **Queries**: No impact on query performance (encryption is transparent to database)

### Optimization Tips

1. **Only Encrypt Sensitive Fields**: Don't encrypt fields that don't need protection
2. **Use Indexes on Non-Encrypted Fields**: You can't efficiently search encrypted data
3. **Cache Decrypted Values**: If reading the same data frequently, cache in memory
4. **Batch Operations**: Use transactions for bulk inserts/updates

### Searchability Limitation

**You cannot search encrypted fields directly** because the encryption is deterministic with random salt/IV:

```typescript
// ❌ This will NOT work - you can't search encrypted fields
const results = await db
  .select()
  .from(githubInstallations)
  .where(eq(githubInstallations.webhookSecret, "my-secret")); // Won't match

// ✅ Instead, search by non-encrypted fields
const results = await db
  .select()
  .from(githubInstallations)
  .where(eq(githubInstallations.accountLogin, "myorg")); // Then filter in application
```

If you need searchable encryption, consider:
- **Hash-based indexing**: Store a hash of the value for searching
- **Deterministic encryption**: Use a deterministic encryption mode (less secure)
- **Token-based search**: Use tokens/IDs instead of searching encrypted values

## Troubleshooting

### Error: "ENCRYPTION_KEY not found"

**Problem**: The `ENCRYPTION_KEY` environment variable is not set.

**Solution**: Generate and set the encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Add to .env: ENCRYPTION_KEY=<generated_key>
```

### Error: "Failed to decrypt data"

**Possible Causes**:
1. **Wrong encryption key**: The key used to decrypt differs from the key used to encrypt
2. **Data corruption**: The encrypted data was modified or corrupted
3. **Invalid format**: The data is not in the expected `salt:iv:authTag:data` format

**Solutions**:
- Verify you're using the correct `ENCRYPTION_KEY`
- Check database backups if data is corrupted
- Ensure no manual modifications to encrypted fields

### Error: "Invalid encrypted data format"

**Problem**: The encrypted data doesn't have the expected format.

**Possible Causes**:
1. **Plain text data**: The field contains unencrypted plain text
2. **Wrong encryption**: Data was encrypted with a different method

**Solution**: Run the data migration script to properly encrypt existing data.

### Performance Issues

**Problem**: Encryption/decryption is slow.

**Solutions**:
1. Use connection pooling to reuse database connections
2. Cache frequently accessed decrypted values
3. Batch operations instead of individual queries
4. Consider hardware acceleration for AES (most modern CPUs support AES-NI)

## References

- [AES-GCM](https://en.wikipedia.org/wiki/Galois/Counter_Mode): Galois/Counter Mode authenticated encryption
- [Node.js Crypto](https://nodejs.org/api/crypto.html): Node.js cryptography module
- [Drizzle Custom Types](https://orm.drizzle.team/docs/custom-types): Custom column types in Drizzle ORM
- [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html): Security best practices
