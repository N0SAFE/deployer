/**
 * Ingress provider vocabulary — how a client reaches the stack's ingress.
 *
 * Exported as its own entity so the API, the web app and the supervisors share
 * one definition of the four providers and what each one requires.
 */

export {
	ingressProviderSchema,
	INGRESS_PROVIDERS,
	DEFAULT_INGRESS_PROVIDER,
	INGRESS_PROVIDER_TRAITS,
	ingressProviderTraits,
	isExternallyReachable,
} from '@repo/contracts-entities/entities/ingress/provider.schema'

export type {
	IngressProvider,
	IngressProviderTraits,
} from '@repo/contracts-entities/entities/ingress/provider.schema'
