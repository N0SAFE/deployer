import { TraefikConfigBuilder } from "@/core/modules/traefik/config-builder/builders";
import { Logger } from "@nestjs/common";
import { customType } from "drizzle-orm/pg-core";

const logger = new Logger("TraefikConfigBuilder");

/**
 * Serializes a TraefikConfigBuilder to JSON string for database storage
 * @internal Exported for testing purposes
 */
export function serializeTraefikConfigBuilder(value: TraefikConfigBuilder): string {
  try {
    // Build the config object from the builder
    const config = value.build();

    // Serialize to JSON string for storage
    return JSON.stringify(config);
  } catch (error) {
    logger.error("Failed to serialize TraefikConfigBuilder to database", { error });
    // Return empty config as fallback
    return JSON.stringify({});
  }
}

/**
 * Deserializes a JSON string or object to TraefikConfigBuilder
 * @internal Exported for testing purposes
 */
export function deserializeTraefikConfigBuilder(value: string): TraefikConfigBuilder {
  if (!value) return new TraefikConfigBuilder();

  try {
    // Use the static load method to create a builder from the config
    return TraefikConfigBuilder.load(value);
  } catch (error) {
    logger.error("Failed to deserialize TraefikConfigBuilder from database", { error });
    // Return empty builder as fallback
    return new TraefikConfigBuilder();
  }
}

/**
 * Custom Drizzle column type that automatically serializes/deserializes TraefikConfigBuilder
 * 
 * Usage in schema:
 * ```typescript
 * import { traefikConfigBuilder } from './custom-types/traefik-config-builder';
 * 
 * export const services = pgTable('services', {
 *   traefikConfig: traefikConfigBuilder('traefik_config'),
 *   optionalConfig: traefikConfigBuilder('optional_config').nullable(),
 * });
 * ```
 * 
 * The serialization/deserialization happens automatically:
 * - When inserting/updating: TraefikConfigBuilder → JSON stored in DB
 * - When selecting: JSON from DB → TraefikConfigBuilder instance returned to app
 * 
 * Variables are preserved during storage and only resolved during Traefik sync.
 */
export const traefikConfigBuilder = customType<{
  data: TraefikConfigBuilder;
  driverData: string;
  notNull: boolean;
  default: false;
}>({
  dataType() {
    return "jsonb";
  },

  // Convert from database to application (deserialize JSON to builder)
  fromDriver(value: string): TraefikConfigBuilder {
    return deserializeTraefikConfigBuilder(value);
  },

  // Convert from application to database (serialize builder to JSON)
  toDriver(value: TraefikConfigBuilder): string {
    return serializeTraefikConfigBuilder(value);
  },
});

