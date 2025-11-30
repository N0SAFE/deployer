/**
 * Traefik Events Module
 * 
 * Provides real-time event streaming for Traefik configuration operations.
 */

export { TraefikEventService } from './traefik-event.service';

export {
  traefikEventContracts,
  configSyncContract,
  configChangeContract,
  validationResultContract,
  cleanupContract,
  type TraefikEventContracts,
  type ConfigSyncInput,
  type ConfigSyncOutput,
  type ConfigChangeInput,
  type ConfigChangeOutput,
  type ValidationResultInput,
  type ValidationResultOutput,
  type CleanupInput,
  type CleanupOutput,
} from './traefik-event.contracts';
