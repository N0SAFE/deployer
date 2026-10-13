// packages/nest/schema/src/codecs/codec-registry.ts
import { Logger } from "@nestjs/common";
import { AppError } from "@deployer/errors";
import { customType } from "drizzle-orm/pg-core";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
var logger = new Logger("SchemaCodecs");
var ALGORITHM = "aes-256-gcm";
var IV_LENGTH = 16;
var SALT_LENGTH = 32;
var KEY_LENGTH = 32;
var registry = {};
function configureEncryption2(provider) {
  registry.encryption = provider;
}
function configureTraefikConfigCodec2(codec) {
  registry.traefik = codec;
}
function configureSchemaCodecs2(config) {
  if (config.encryption !== undefined)
    configureEncryption2(config.encryption);
  if (config.traefik !== undefined)
    configureTraefikConfigCodec2(config.traefik);
}
function requireEncryption() {
  if (registry.encryption === undefined) {
    throw new AppError("encryptedText column used before the encryption key was configured — " + "call configureSchemaCodecs({ encryption }) at boot", "SCHEMA_CODEC_NOT_CONFIGURED");
  }
  return registry.encryption;
}
function encryptSecret2(text) {
  if (!text)
    return text;
  try {
    const key = requireEncryption().resolveKey();
    const salt = randomBytes(SALT_LENGTH);
    const derived = scryptSync(key, salt, KEY_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, derived, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${salt.toString("hex")}:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
  } catch (error) {
    if (error instanceof AppError)
      throw error;
    logger.error("Encryption error:", { error });
    throw new AppError("Failed to encrypt data", "ENCRYPTION_ERROR");
  }
}
function parseEncryptedPayload(payload) {
  const parts = payload.split(":");
  const [saltHex, ivHex, authTagHex, encryptedData] = parts;
  if (parts.length !== 4 || saltHex === undefined || ivHex === undefined || authTagHex === undefined || encryptedData === undefined) {
    throw new AppError("Invalid encrypted data format", "ENCRYPTION_ERROR");
  }
  return { saltHex, ivHex, authTagHex, encryptedData };
}
function decryptSecret2(payload) {
  if (!payload)
    return payload;
  try {
    const { saltHex, ivHex, authTagHex, encryptedData } = parseEncryptedPayload(payload);
    const salt = Buffer.from(saltHex, "hex");
    const derived = scryptSync(requireEncryption().resolveKey(), salt, KEY_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, derived, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return decipher.update(encryptedData, "hex", "utf8") + decipher.final("utf8");
  } catch (error) {
    if (error instanceof AppError)
      throw error;
    logger.error("Decryption error:", { error });
    throw new AppError("Failed to decrypt data", "ENCRYPTION_ERROR");
  }
}
var encryptedText2 = customType({
  dataType() {
    return "text";
  },
  fromDriver(value) {
    return decryptSecret2(value);
  },
  toDriver(value) {
    return encryptSecret2(value);
  }
});
var traefikConfigBuilder2 = customType({
  dataType() {
    return "jsonb";
  },
  fromDriver(value) {
    return readTraefikConfig2(value);
  },
  toDriver(value) {
    return writeTraefikConfig(value);
  }
});
function readTraefikConfig2(value) {
  const codec = requireTraefik();
  if (!value)
    return codec.empty();
  try {
    return codec.load(value);
  } catch (error) {
    logger.error("Failed to deserialize traefik config from database", { error });
    return codec.empty();
  }
}
function writeTraefikConfig(value) {
  try {
    return JSON.stringify(requireTraefik().build(value));
  } catch (error) {
    logger.error("Failed to serialize traefik config to database", { error });
    return JSON.stringify({});
  }
}
function requireTraefik() {
  const codec = registry.traefik;
  if (codec === undefined) {
    throw new AppError("traefikConfigBuilder column used before the codec was configured — " + "call configureSchemaCodecs({ traefik }) at boot", "SCHEMA_CODEC_NOT_CONFIGURED");
  }
  return codec;
}
function generateEncryptionKey2() {
  return randomBytes(32).toString("hex");
}

export { configureEncryption2, configureTraefikConfigCodec2, configureSchemaCodecs2, encryptSecret2, decryptSecret2, encryptedText2, traefikConfigBuilder2, readTraefikConfig2, generateEncryptionKey2 };
