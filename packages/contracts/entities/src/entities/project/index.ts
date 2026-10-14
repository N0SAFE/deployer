export {
  projectSchema,
  projectWithStatsSchema,
} from '@deployer/contracts-entities/entities/project/core.schema'

export {
  projectNetworkConfigSchema,
  serviceNetworkConfigSchema,
  networkDnsRecordTypeSchema,
  networkTlsSchema,
  defaultProjectNetworkConfig,
  defaultServiceNetworkConfig,
  NETWORK_DNS_RECORD_TYPES,
} from '@deployer/contracts-entities/entities/project/network.schema'

export type {
  ProjectNetworkConfig,
  ServiceNetworkConfig,
  NetworkDnsRecordType,
  NetworkTls,
} from '@deployer/contracts-entities/entities/project/network.schema'

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
} from '@deployer/contracts-entities/entities/project/settings.schema'

export type {
  ProjectSettings,
} from '@deployer/contracts-entities/entities/project/settings.schema'

export {
  projectRoleSchema,
  collaboratorSchema,
  inviteCollaboratorSchema,
} from '@deployer/contracts-entities/entities/project/collaborators.schema'

export {
  environmentTypeSchema,
  environmentStatusSchema,
  environmentRulesSchema,
  projectEnvironmentSchema,
} from '@deployer/contracts-entities/entities/project/environments.schema'

export type {
  EnvironmentRules,
} from '@deployer/contracts-entities/entities/project/environments.schema'

export {
  serviceEnvironmentLinkSchema,
  serviceEnvironmentLinkInputSchema,
} from '@deployer/contracts-entities/entities/project/service-environment-link.schema'

export type {
  ServiceEnvironmentLink,
  ServiceEnvironmentLinkInput,
} from '@deployer/contracts-entities/entities/project/service-environment-link.schema'

// Re-export the environment KIND + TRIGGER primitives (defined in contracts-common)
// so contracts can import them from @deployer/contracts-entities like the rest.
export {
  environmentKindSchema,
  environmentTriggerSchema,
  environmentTriggerSourceSchema,
  type EnvironmentKind,
  type EnvironmentTrigger,
  type EnvironmentTriggerSource,
} from '@deployer/contracts-common'

export {
  templateVariableSchema,
  variableTemplateSchema,
} from '@deployer/contracts-entities/entities/project/templates.schema'
