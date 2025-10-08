import type { z } from 'zod';

/**
 * Configuration schema definition with metadata
 */
export interface ConfigSchemaField {
  /** Field key/name */
  key: string;
  /** Human-readable label */
  label: string;
  /** Field description/help text */
  description?: string;
  /** Zod schema for validation */
  schema: z.ZodType<any>;
  /** Field type hint for UI rendering */
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'password' | 'url' | 'json' | 'array';
  /** Whether field is required */
  required: boolean;
  /** Default value */
  defaultValue?: any;
  /** Options for select/radio fields */
  options?: Array<{ label: string; value: string | number | boolean }>;
  /** Placeholder text */
  placeholder?: string;
  /** Field grouping/category */
  group?: string;
  /** Conditional visibility rules */
  conditional?: {
    /** Field to watch */
    field: string;
    /** Required value for visibility */
    value: any;
    /** Operator: equals, notEquals, in, notIn */
    operator?: 'equals' | 'notEquals' | 'in' | 'notIn';
  };
  /** UI hints */
  ui?: {
    /** Display order */
    order?: number;
    /** Full width field */
    fullWidth?: boolean;
    /** Show as inline field */
    inline?: boolean;
    /** Icon to display */
    icon?: string;
  };
}

/**
 * Complete configuration schema for a provider or builder
 */
export interface ConfigSchema {
  /** Schema identifier */
  id: string;
  /** Schema version */
  version: string;
  /** Schema title */
  title: string;
  /** Schema description */
  description: string;
  /** Field definitions */
  fields: ConfigSchemaField[];
  /** Schema validation (composite) */
  validate?: (config: any) => Promise<{ valid: boolean; errors: string[] }>;
  /** Transform function for backwards compatibility */
  transform?: (config: any) => any;
}

/**
 * Base provider interface
 */
export interface IProvider {
  /** Provider unique identifier */
  readonly id: string;
  /** Provider display name */
  readonly name: string;
  /** Provider description */
  readonly description: string;
  /** Provider icon/logo URL */
  readonly icon?: string;
  /** Supported builders */
  readonly supportedBuilders: string[];
  
  /**
   * Get configuration schema for this provider
   */
  getConfigSchema(): ConfigSchema;
  
  /**
   * Get default configuration
   */
  getDefaultConfig(): Record<string, any>;
  
  /**
   * Validate provider configuration
   */
  validateConfig(config: any): Promise<{ valid: boolean; errors: string[] }>;
  
  /**
   * Get Traefik template for this provider
   */
  getTraefikTemplate?(): string;
}

/**
 * Base builder interface
 */
export interface IBuilder {
  /** Builder unique identifier */
  readonly id: string;
  /** Builder display name */
  readonly name: string;
  /** Builder description */
  readonly description: string;
  /** Builder icon */
  readonly icon?: string;
  /** Compatible providers */
  readonly compatibleProviders: string[];
  
  /**
   * Get configuration schema for this builder
   */
  getConfigSchema(): ConfigSchema;
  
  /**
   * Get default configuration
   */
  getDefaultConfig(): Record<string, any>;
  
  /**
   * Validate builder configuration
   */
  validateConfig(config: any): Promise<{ valid: boolean; errors: string[] }>;
}

/**
 * Provider registry metadata
 */
export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: 'git' | 'registry' | 'storage' | 'manual' | 'other';
  supportedBuilders: string[];
  tags: string[];
}

/**
 * Builder registry metadata
 */
export interface BuilderMetadata {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: 'container' | 'static' | 'serverless' | 'other';
  compatibleProviders: string[];
  tags: string[];
}
