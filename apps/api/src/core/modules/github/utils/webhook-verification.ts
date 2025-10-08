/**
 * Parse GitHub event type from headers
 */
export function getGitHubEventType(headers: {
  'x-github-event'?: string
}): string | null {
  return headers['x-github-event'] || null
}

/**
 * Parse GitHub delivery ID from headers
 */
export function getGitHubDeliveryId(headers: {
  'x-github-delivery'?: string
}): string | null {
  return headers['x-github-delivery'] || null
}
