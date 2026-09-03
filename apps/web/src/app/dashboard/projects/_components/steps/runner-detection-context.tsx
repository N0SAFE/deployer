'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Best-effort hints extracted from the repository contents by the
 * detectRunner endpoint. Shared between StepProvider (which runs the
 * detection) and StepRunner (which displays + applies the result).
 */
export interface RunnerDetectionHints {
  language?: string
  framework?: string
  packageManager?: string
  nodeVersion?: string
  startCommand?: string
  buildCommand?: string
  ports?: number[]
  rootPath?: string
  buildContext?: string
  dockerfilePath?: string
  composeFile?: string
  outputDir?: string
  indexFile?: string
  /** All compose files found anywhere in the repo (best candidate first). */
  composeCandidates?: {
    path: string
    kind: 'prod' | 'dev' | 'base' | 'override'
    serviceCount?: number
  }[]
  /** Other useful files / configurations worth recommending. */
  recommendations?: {
    kind: 'ci' | 'dockerfile' | 'env-example' | 'kubernetes' | 'terraform' | 'makefile' | 'package-manager' | 'ignore-file'
    path: string
    label?: string
  }[]
  /** Sub-services detected inside a compose (orchestrator) manifest. */
  composeServices?: {
    name: string
    image: string
    build?: { context?: string; dockerfile?: string; args?: Record<string, string> }
    ports?: number[]
    dependsOn?: string[]
    dependsOnCondition?: string
    environment?: Record<string, string>
    replicas?: number
    command?: string
    entrypoint?: string
    volumes?: string[]
    networks?: string[]
    labels?: Record<string, string>
    secrets?: string[]
    restart?: string
    healthCheck?: {
      test?: string[]
      interval?: number
      timeout?: number
      retries?: number
      startPeriod?: number
    }
    resources?: {
      cpus?: number
      memory?: string
    }
  }[]
}

interface RunnerDetectionState {
  /** Builder id of the detected runner (docker, dockerfile, docker-compose, …). */
  builderId: string | null
  hints: RunnerDetectionHints | null
  /** Source repo the detection was run against — needed to re-detect (e.g. compose switch). */
  source: { owner: string; repo: string; appId: string } | null
  setDetection: (builderId: string | null, hints: RunnerDetectionHints | null) => void
  /** Remember where detection came from so we can re-run it for a different compose file. */
  setSource: (source: { owner: string; repo: string; appId: string }) => void
  clear: () => void
}

const RunnerDetectionContext = createContext<RunnerDetectionState | null>(null)

export function RunnerDetectionProvider({ children }: { children: ReactNode }) {
  const [builderId, setBuilderId] = useState<string | null>(null)
  const [hints, setHints] = useState<RunnerDetectionHints | null>(null)
  const [source, setSource] = useState<{ owner: string; repo: string; appId: string } | null>(null)

  const value = useMemo<RunnerDetectionState>(() => ({
    builderId,
    hints,
    source,
    setDetection: (nextBuilder, nextHints) => {
      setBuilderId(nextBuilder)
      setHints(nextHints)
    },
    setSource: (nextSource) => {
      setSource(nextSource)
    },
    clear: () => {
      setBuilderId(null)
      setHints(null)
      setSource(null)
    },
  }), [builderId, hints, source])

  return (
    <RunnerDetectionContext.Provider value={value}>
      {children}
    </RunnerDetectionContext.Provider>
  )
}

export function useRunnerDetection(): RunnerDetectionState {
  const ctx = useContext(RunnerDetectionContext)
  if (!ctx) throw new Error('useRunnerDetection must be used within RunnerDetectionProvider')
  return ctx
}
