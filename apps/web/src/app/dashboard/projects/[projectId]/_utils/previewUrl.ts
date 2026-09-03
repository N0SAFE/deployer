/**
 * Preview URL helpers — mirror the server-side PreviewNamingService naming
 * logic so the UI can show where a preview will be reachable, derived from the
 * service's configured domain mappings.
 */

export type PreviewNamingStrategy = 'pr' | 'branch' | 'branch_hash' | 'custom'

function slugify(input: string, maxLength = 48): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
  return slug || 'preview'
}

function hashCode(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(h, 31) + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).slice(0, 7)
}

export interface PreviewNameInput {
  serviceId: string
  branchName?: string | null
  prNumber?: number | null
  commitSha?: string | null
}

export function buildPreviewName(
  input: PreviewNameInput & { strategy: PreviewNamingStrategy },
): { previewName: string } {
  const { strategy, branchName, prNumber, serviceId, commitSha } = input
  switch (strategy) {
    case 'pr':
      return { previewName: prNumber != null ? `pr-${prNumber}` : slugify(branchName ?? 'preview') }
    case 'branch':
      return { previewName: slugify(branchName ?? 'preview') }
    case 'branch_hash': {
      const slug = slugify(branchName ?? 'preview')
      const seed = `${serviceId}:${branchName ?? ''}:${commitSha ?? ''}`
      return { previewName: `${slug}-${hashCode(seed)}` }
    }
    case 'custom':
      return { previewName: slugify(branchName ?? 'preview') }
  }
}

/**
 * Resolve a preview URL from a host pattern. Supported tokens:
 *   {{preview_name}} {{branch}} {{pr_number}} {{commit_sha}}
 * Example: `{{preview_name}}.preview.example.com`
 */
export function resolvePreviewUrlPattern(pattern: string, input: PreviewNameInput): string {
  const branch = slugify(input.branchName ?? '')
  return pattern
    .replaceAll('{{preview_name}}', buildPreviewName({ ...input, strategy: 'branch' }).previewName)
    .replaceAll('{{branch}}', branch)
    .replaceAll('{{pr_number}}', input.prNumber != null ? String(input.prNumber) : '')
    .replaceAll('{{commit_sha}}', input.commitSha ? input.commitSha.slice(0, 7) : '')
}

/** Default preview host pattern based on a base domain (e.g. example.com). */
export function defaultPreviewPattern(baseDomain: string): string {
  const host = baseDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return `{{preview_name}}.preview.${host}`
}
