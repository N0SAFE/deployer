import type { useProviderSchema } from '@/domains/provider-schema/hooks'

/** A provider/builder config schema as returned by the provider-schema API. */
export type ConfigSchema = NonNullable<ReturnType<typeof useProviderSchema>['data']>
export type ConfigField = ConfigSchema['fields'][number]

/** UI field key → persisted entity key, where they differ. */
export const UI_TO_ENTITY: Record<string, string> = {
  repositoryUrl: 'sourceUrl',
  dockerfilePath: 'dockerfilePath',
  buildArgs: 'buildArgs',
  buildContext: 'buildContext',
}

/** Render any form value as text without ever printing "[object Object]". */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value)
}

/** Schema defaults overlaid with the values already persisted on the service. */
export function initialFormValues(
  fields: readonly Pick<ConfigField, 'key' | 'defaultValue'>[],
  existing: Record<string, unknown> | null | undefined,
  keyFromEntity: (entityKey: string) => string = (k) => k,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.defaultValue !== undefined) values[f.key] = f.defaultValue
  }
  for (const [k, v] of Object.entries(existing ?? {})) values[keyFromEntity(k)] = v
  return values
}

/** Entity key → UI key (inverse of UI_TO_ENTITY). */
export function entityToUiKey(entityKey: string): string {
  return Object.entries(UI_TO_ENTITY).find(([, e]) => e === entityKey)?.[0] ?? entityKey
}

/** Persistable config from the current form values (fills untouched defaults). */
export function buildConfigFromFields(
  fields: readonly Pick<ConfigField, 'key' | 'defaultValue'>[],
  formValues: Record<string, unknown>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const f of fields) {
    const val = formValues[f.key]
    if (val !== undefined && val !== null && val !== '') {
      config[f.key] = val
    } else if (f.defaultValue !== undefined && f.defaultValue !== null && !(f.key in formValues)) {
      config[f.key] = f.defaultValue
    }
  }
  return config
}

/** Rename UI keys to their entity keys. */
export function toEntityConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) out[UI_TO_ENTITY[k] ?? k] = v
  return out
}
