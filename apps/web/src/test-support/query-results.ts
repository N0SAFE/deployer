import { vi, type Mock } from 'vitest'

/**
 * Query / mutation result builders for page-state tests.
 *
 * Pages read TanStack-Query-shaped objects returned by the `@/domains/*` hooks.
 * These builders produce the same shape for the three states a page must
 * handle (loading, error, success) so a spec can drive any hook into any state
 * without a real QueryClient or backend.
 */

export interface QueryResultStub<T> {
	data: T | undefined
	error: Error | null
	status: 'pending' | 'error' | 'success'
	fetchStatus: 'idle' | 'fetching'
	isPending: boolean
	isLoading: boolean
	isFetching: boolean
	isRefetching: boolean
	isError: boolean
	isSuccess: boolean
	isFetched: boolean
	isPlaceholderData: boolean
	isStale: boolean
	dataUpdatedAt: number
	errorUpdatedAt: number
	refetch: Mock
}

const base = {
	isPlaceholderData: false,
	isStale: false,
	isRefetching: false,
	dataUpdatedAt: 0,
	errorUpdatedAt: 0,
}

export function loadingQuery<T = never>(refetch: Mock = vi.fn()): QueryResultStub<T> {
	return {
		...base,
		data: undefined,
		error: null,
		status: 'pending',
		fetchStatus: 'fetching',
		isPending: true,
		isLoading: true,
		isFetching: true,
		isError: false,
		isSuccess: false,
		isFetched: false,
		refetch,
	}
}

export function errorQuery<T = never>(message = 'upstream exploded', refetch: Mock = vi.fn()): QueryResultStub<T> {
	return {
		...base,
		data: undefined,
		error: new Error(message),
		status: 'error',
		fetchStatus: 'idle',
		isPending: false,
		isLoading: false,
		isFetching: false,
		isError: true,
		isSuccess: false,
		isFetched: true,
		errorUpdatedAt: Date.now(),
		refetch,
	}
}

export function successQuery<T>(data: T, refetch: Mock = vi.fn()): QueryResultStub<T> {
	return {
		...base,
		data,
		error: null,
		status: 'success',
		fetchStatus: 'idle',
		isPending: false,
		isLoading: false,
		isFetching: false,
		isError: false,
		isSuccess: true,
		isFetched: true,
		dataUpdatedAt: Date.now(),
		refetch,
	}
}

export interface MutationStub {
	mutate: Mock
	mutateAsync: Mock
	reset: Mock
	data: undefined
	error: null
	variables: undefined
	status: 'idle'
	isIdle: true
	isPending: false
	isError: false
	isSuccess: false
}

export function idleMutation(): MutationStub {
	return {
		mutate: vi.fn(),
		mutateAsync: vi.fn().mockResolvedValue({}),
		reset: vi.fn(),
		data: undefined,
		error: null,
		variables: undefined,
		status: 'idle',
		isIdle: true,
		isPending: false,
		isError: false,
		isSuccess: false,
	}
}
