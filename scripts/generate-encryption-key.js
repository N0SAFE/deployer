#!/usr/bin/env node

/**
 * Generate a secure encryption key for database field encryption
 * 
 * Usage:
 *   node scripts/generate-encryption-key.js
 * 
 * This will generate a 256-bit (32 bytes) encryption key in hex format
 * suitable for use with the encryptedText custom Drizzle column type.
 * 
 * Add the generated key to your .env file:
 *   ENCRYPTION_KEY=<generated_key_here>
 */

const crypto = require('crypto');

function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

console.log('\n🔐 Database Encryption Key Generator\n');
console.log('Generate a new encryption key for your database:');
console.log('━'.repeat(80));

const key = generateEncryptionKey();

console.log('\n✨ Generated Encryption Key:\n');
console.log(`  ${key}`);
console.log('\n');

console.log('📝 Add this to your .env file:\n');
console.log(`  ENCRYPTION_KEY=${key}`);
console.log('\n');

console.log('⚠️  IMPORTANT SECURITY NOTES:');
console.log('  • Never commit this key to version control');
console.log('  • Use different keys for dev, staging, and production');
console.log('  • Store production keys in a secure secrets manager');
console.log('  • Backup this key securely - without it, encrypted data cannot be recovered');
console.log('  • Rotate keys periodically (every 90-180 days recommended)');
console.log('\n' + '━'.repeat(80) + '\n');
