import { defineInvalidations } from '@/domains/shared/helpers'
import { dockerEndpoints } from './endpoints'

export const dockerInvalidations = defineInvalidations(dockerEndpoints, {})
