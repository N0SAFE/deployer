/**
 * Core Provider Interface
 * 
 * All providers (GitHub, GitLab, Git, Static Files, etc.) must implement this interface.
 * Providers are ONLY responsible for delivering source files to the deployment pipeline.
 * 
 * The deployment pipeline then handles:
 * 1. Building (using builder strategy: Docker, Nixpacks, Static, Docker Compose, etc.)
 * 2. Deploying (same process for all sources)
 * 3. Health checks and rollbacks
 */

export interface SourceFiles {
  /**
   * Unique identifier for this source
   */
  sourceId: string;

  /**
   * Path to the extracted files on the host
   */
  localPath: string;

  /**
   * Metadata about the source
   */
  metadata: {
    provider: 'github' | 'gitlab' | 'git' | 'static' | 'docker-registry' | 's3' | 'custom';
    
    // Version information
    version?: string;
    commitSha?: string;
    tag?: string;
    branch?: string;
    
    // Author information
    author?: string;
    message?: string;
    timestamp?: Date;
    
    // Additional provider-specific metadata
    [key: string]: any;
  };

  /**
   * List of changed files (for cache detection)
   */
  changedFiles?: string[];

  /**
   * Cleanup function to remove temporary files
   */
  cleanup: () => Promise<void>;
}

export interface ProviderConfig {
  /**
   * Provider type
   */
  type: 'github' | 'gitlab' | 'git' | 'static' | 'docker-registry' | 's3' | 'custom';

  /**
   * Provider-specific configuration
   */
  config: Record<string, any>;

  /**
   * Repository/source configuration
   */
  repository?: {
    url?: string;
    branch?: string;
    tag?: string;
    accessToken?: string;
    sshKey?: string;
  };

  /**
   * Monorepo support
   */
  monorepo?: {
    basePath: string;
    watchPaths: string[];
    ignorePaths: string[];
  };

  /**
   * Cache configuration
   */
  cache?: {
    strategy: 'strict' | 'loose';
    enabled: boolean;
  };
}

export interface DeploymentTrigger {
  /**
   * What triggered this deployment
   */
  trigger: 'webhook' | 'manual' | 'schedule' | 'api';

  /**
   * Event that caused the trigger (for webhooks)
   */
  event?: string;

  /**
   * User who triggered (for manual)
   */
  userId?: string;

  /**
   * Additional trigger data
   */
  data?: Record<string, any>;
}

/**
 * Base Provider Interface
 * All providers must implement this
 */
export interface IDeploymentProvider {
  /**
   * Provider name
   */
  readonly name: string;

  /**
   * Provider type
   */
  readonly type: 'github' | 'gitlab' | 'git' | 'static' | 'docker-registry' | 's3' | 'custom';

  /**
   * Fetch source files from the provider
   * 
   * @param config - Provider configuration
   * @param trigger - What triggered this fetch
   * @returns Source files ready for building
   */
  fetchSource(config: ProviderConfig, trigger: DeploymentTrigger): Promise<SourceFiles>;

  /**
   * Validate provider configuration
   */
  validateConfig(config: ProviderConfig): Promise<{ valid: boolean; errors?: string[] }>;

  /**
   * Check if deployment should be skipped based on cache
   * 
   * @param config - Provider configuration
   * @param trigger - What triggered this fetch
   * @returns Whether to skip and why
   */
  shouldSkipDeployment(
    config: ProviderConfig,
    trigger: DeploymentTrigger,
  ): Promise<{ shouldSkip: boolean; reason: string }>;

  /**
   * Get the display name/version for this deployment
   */
  getDeploymentVersion(source: SourceFiles): string;

  /**
   * Get the default Traefik configuration template for this provider
   * 
   * @returns YAML template string with variables like ~##domain##~, ~##subdomain##~, etc.
   */
  getTraefikTemplate(): string;
}

/**
 * Webhook Provider Interface
 * Providers that support webhooks should implement this
 */
export interface IWebhookProvider extends IDeploymentProvider {
  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;

  /**
   * Parse webhook payload into trigger
   */
  parseWebhookPayload(
    event: string,
    payload: Record<string, any>,
  ): Promise<DeploymentTrigger | null>;

  /**
   * Register webhook with the provider (if applicable)
   */
  registerWebhook?(
    config: ProviderConfig,
    webhookUrl: string,
    events: string[],
  ): Promise<{ webhookId: string; secret: string }>;
}

/**
 * OAuth Provider Interface
 * Providers that support OAuth should implement this
 */
export interface IOAuthProvider extends IDeploymentProvider {
  /**
   * Get OAuth authorization URL
   */
  getAuthorizationUrl(redirectUri: string, state: string): string;

  /**
   * Exchange code for access token
   */
  exchangeCodeForToken(code: string, redirectUri: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;

  /**
   * Refresh access token
   */
  refreshAccessToken?(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
}
