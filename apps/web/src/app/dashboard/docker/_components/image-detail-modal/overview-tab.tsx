'use client'

import type { ReactNode } from 'react'
import type { DockerImageInspectDetail } from '@deployer/contracts-entities'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { formatBytes } from '../../_utils/format'
import { DockerCopyableId } from '../docker-copy-button'
import { DockerRelativeTime } from '../docker-relative-time'

export interface ImageSnapshot {
  registry: string
  repository: string
  tag: string | null
  digest: string | null
  sizeBytes: number | null
  lastSeenAt: string
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-2' : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  )
}

/** Identity, size and usage of the image. Prefers the full inspect payload over the list snapshot. */
export function ImageOverviewTab({ imageId, inspect, snapshot }: { imageId: string; inspect: DockerImageInspectDetail | null; snapshot: ImageSnapshot }) {
  const digest = inspect?.digest ?? snapshot.digest
  const sizeBytes = inspect?.sizeBytes ?? snapshot.sizeBytes
  const containerIds = inspect?.usedByContainerIds ?? []
  const repoTags = inspect?.repoTags ?? []
  const tag = inspect?.tag ?? snapshot.tag

  return (
    <div className="flex min-h-0 flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {inspect ? (
          containerIds.length > 0
            ? <Badge variant="default" className="text-xs">In use by {containerIds.length} container{containerIds.length === 1 ? '' : 's'}</Badge>
            : <Badge variant="secondary" className="text-xs">Not used by any container</Badge>
        ) : null}
        {!tag ? <Badge variant="outline" className="text-xs">Untagged (dangling)</Badge> : null}
      </div>

      <dl className="grid gap-3 md:grid-cols-2">
        <Field label="Registry">{inspect?.registry ?? snapshot.registry}</Field>
        <Field label="Repository">{inspect?.repository ?? snapshot.repository}</Field>
        <Field label="Tag"><span className="font-mono text-xs">{tag ?? '—'}</span></Field>
        <Field label="Size"><span className="tabular-nums" title={sizeBytes === null ? undefined : `${String(sizeBytes)} bytes`}>{formatBytes(sizeBytes)}</span></Field>
        <Field label="Image ID"><DockerCopyableId value={imageId} short={imageId.replace(/^sha256:/u, '').slice(0, 12)} label="image ID" /></Field>
        <Field label="Digest">
          {digest ? <DockerCopyableId value={digest} short={digest.replace(/^sha256:/u, '').slice(0, 19)} label="digest" /> : '—'}
        </Field>
        <Field label="Last seen"><DockerRelativeTime value={inspect?.lastSeenAt ?? snapshot.lastSeenAt} /></Field>
        <Field label="Platform">{inspect?.os || inspect?.architecture ? `${inspect.os ?? '?'} / ${inspect.architecture ?? '?'}` : '—'}</Field>
        <Field label="Tags on this image" wide>
          {repoTags.length > 0
            ? <span className="flex flex-wrap gap-1">{repoTags.map((repoTag) => <code key={repoTag} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{repoTag}</code>)}</span>
            : '—'}
        </Field>
        <Field label="Containers using it" wide>
          {containerIds.length > 0
            ? <span className="flex flex-wrap gap-x-3 gap-y-1">{containerIds.map((containerId) => <DockerCopyableId key={containerId} value={containerId} short={containerId.slice(0, 12)} label="container ID" />)}</span>
            : 'None'}
        </Field>
      </dl>
    </div>
  )
}
