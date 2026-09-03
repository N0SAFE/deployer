export {
  projectSchema,
  projectWithStatsSchema,
} from './core.schema'

export {
  projectNetworkConfigSchema,
  serviceNetworkConfigSchema,
  networkDnsRecordTypeSchema,
  networkTlsSchema,
  defaultProjectNetworkConfig,
  defaultServiceNetworkConfig,
  NETWORK_DNS_RECORD_TYPES,
} from './network.schema'

export type {
  ProjectNetworkConfig,
  ServiceNetworkConfig,
  NetworkDnsRecordType,
  NetworkTls,
} from './network.schema'

export {
  projectBaseEnvironmentSettingsSchema,
  projectPreviewEnvironmentSettingsSchema,
  projectDevelopmentEnvironmentSettingsSchema,
  projectEnvironmentSettingsByNameSchema,
  projectGeneralSettingsSchema,
  projectEnvironmentSettingsSchema,
  projectDeploymentSettingsSchema,
  projectSecuritySettingsSchema,
  projectResourceSettingsSchema,
  projectNotificationSettingsSchema,
  projectSettingsSchema,
  projectGeneralConfigSchema,
  projectEnvironmentConfigSchema,
  projectDeploymentConfigSchema,
  projectSecurityConfigSchema,
  projectResourceConfigSchema,
  projectNotificationConfigSchema,
} from './settings.schema'

export type {
  ProjectSettings,
} from './settings.schema'

export {
  projectRoleSchema,
  collaboratorSchema,
  inviteCollaboratorSchema,
} from './collaborators.schema'

export {
  environmentTypeSchema,
  environmentStatusSchema,
  environmentRulesSchema,
  projectEnvironmentSchema,
} from './environments.schema'

export type {
  EnvironmentRules,
} from './environments.schema'

export {
  serviceEnvironmentLinkSchema,
  serviceEnvironmentLinkInputSchema,
} from './service-environment-link.schema'

export type {
  ServiceEnvironmentLink,
  ServiceEnvironmentLinkInput,
} from './service-environment-link.schema'

// Re-export the environment KIND + TRIGGER primitives (defined in contracts-common)
// so contracts can import them from @repo/contracts-entities like the rest.
export {
  environmentKindSchema,
  environmentTriggerSchema,
  environmentTriggerSourceSchema,
  type EnvironmentKind,
  type EnvironmentTrigger,
  type EnvironmentTriggerSource,
} from '@repo/contracts-common'

export {
  templateVariableSchema,
  variableTemplateSchema,
} from './templates.schema'
