import * as crypto from 'crypto'
import { join, basename, relative, extname } from 'path'

import { Context, Effect } from 'effect'
import * as mime from 'mime-types'

import type { traefikServiceConfigs } from '@deployer/nest-schema/global/traefik/index'

import { TRAEFIK_CONFIG_PATH } from '../../platform-ingress/services/ingress-provider-token'
import { LANE_ENTRYPOINTS } from '../../platform-ingress/services/lane-traefik-config'
import { TraefikFileNotFound, TraefikFileWriteRefused } from '../errors'

import type { StorageFailure } from '../../database/storage'
import type {
    VirtualFileItem,
    VirtualDirectoryTree,
    TraefikFileSystemPaths,
    FileSystemNamingConventions,
    FileOperationResult,
    FileContentResult,
    DownloadResult,
    ParsedServiceConfigFileName,
} from '../interfaces'
import type { TraefikRepositoryShape } from '../repositories/traefik.repository'
import type { InferSelectModel } from 'drizzle-orm'

type TraefikServiceConfig = InferSelectModel<typeof traefikServiceConfigs>

type Failure = StorageFailure | TraefikFileNotFound

/**
 * Where Traefik's dynamic configuration lives, how its files are named, and the database-backed "virtual filesystem"
 * the config browser shows (a tree of generated files over the config, certificate, middleware, static-file and backup
 * tables).
 *
 * The path and naming members are pure and synchronous. The virtual filesystem is stateful (it holds the e2e-overridable
 * paths) and reads the database, so it is built once over the repository by `makeTraefikFileSystem`.
 */
export type TraefikFileSystemShape = {
    // ── conventions (pure) ─────────────────────────────────────────────────────────────────────────────────────────────
    readonly getFileSystemPaths: () => TraefikFileSystemPaths
    readonly getNamingConventions: () => FileSystemNamingConventions
    /** Config path of a service: under its project's folder, or `standalone` without a project. */
    readonly generateServiceConfigPath: (
        serviceId: string,
        configId: string,
        projectName?: string
    ) => string
    readonly generateServiceConfigFileName: (
        serviceId: string,
        configId: string
    ) => string
    readonly generateMiddlewarePath: (
        middlewareName: string,
        middlewareId: string,
        isGlobal?: boolean
    ) => string
    readonly generateMiddlewareFileName: (
        middlewareName: string,
        middlewareId: string
    ) => string
    readonly generateSSLCertificatePath: (
        domain: string,
        certificateId: string
    ) => string
    readonly generateSSLCertificateFileName: (
        domain: string,
        certificateId: string
    ) => string
    readonly generateBackupPath: (originalPath: string) => string
    readonly sanitizeFileName: (name: string) => string
    readonly sanitizeDomainName: (domain: string) => string
    readonly parseServiceConfigFileName: (
        fileName: string
    ) => ParsedServiceConfigFileName | null
    readonly isProjectFile: (filePath: string, projectName: string) => boolean
    readonly extractProjectFromPath: (filePath: string) => string | null
    readonly calculateChecksum: (content: string) => string
    /** Re-root every path. Only the e2e harness calls it (to point a shared runtime at its own temp directories). */
    readonly setBasePaths: (env: {
        readonly basePath: string
        readonly backupPath: string
    }) => void

    // ── virtual filesystem (database-backed) ───────────────────────────────────────────────────────────────────────────
    readonly getTraefikFileSystem: (
        path?: string
    ) => Effect.Effect<VirtualDirectoryTree, StorageFailure>
    readonly getProjectFileSystem: (
        projectName: string
    ) => Effect.Effect<VirtualDirectoryTree, StorageFailure>
    readonly getFileContent: (
        filePath: string
    ) => Effect.Effect<FileContentResult, Failure>
    readonly downloadFile: (
        filePath: string
    ) => Effect.Effect<DownloadResult, Failure>
    readonly listProjects: () => Effect.Effect<string[], StorageFailure>
    /** A refused or failed write is a `success: false` result, not an error. */
    readonly writeFile: (
        filePath: string,
        content: string,
        createDirectories?: boolean
    ) => Effect.Effect<FileOperationResult>
    readonly deleteFile: (
        filePath: string
    ) => Effect.Effect<FileOperationResult>
    readonly backupFile: (
        filePath: string
    ) => Effect.Effect<FileOperationResult>
    /** Never fails: an unreadable database lists nothing. */
    readonly getAllConfigFiles: (
        directoryPath?: string
    ) => Effect.Effect<string[]>
    readonly getProjectConfigFiles: (
        projectName: string
    ) => Effect.Effect<string[]>
    readonly fileExists: (filePath: string) => Effect.Effect<boolean>
    readonly calculateFileChecksum: (
        filePath: string
    ) => Effect.Effect<string, Failure>
    /** Virtual directories need no creation; kept so callers can log the intent. */
    readonly ensureDirectoryExists: (dirPath: string) => Effect.Effect<void>
    readonly initializeFileSystemStructure: () => Effect.Effect<void>
}

const NAMING: FileSystemNamingConventions = {
    serviceConfigPrefix: 'service',
    middlewarePrefix: 'middleware',
    sslPrefix: 'ssl',
    fileExtension: 'yml',
    backupSuffix: 'backup',
}

const pathsFor = ({
    basePath,
    backupPath,
}: {
    readonly basePath: string
    readonly backupPath: string
}): TraefikFileSystemPaths => ({
    basePath,
    dynamicPath: join(basePath, 'dynamic'),
    staticPath: join(basePath, 'static'),
    projectsPath: join(basePath, 'dynamic', 'projects'),
    standalonePath: join(basePath, 'dynamic', 'standalone'),
    sslPath: join(basePath, 'ssl'),
    certsPath: join(basePath, 'certs'),
    middlewarePath: join(basePath, 'middleware'),
    pluginsPath: join(basePath, 'plugins'),
    backupPath,
})

// ── pure content / mime helpers ───────────────────────────────────────────────────────────────────────────────────────

/** MIME type from an extension (with or without the dot); Traefik-specific types the `mime-types` database lacks fall back below. */
function getMimeType(extensionOrFilePath: string): string {
    const ext = extensionOrFilePath.startsWith('.')
        ? extensionOrFilePath.slice(1)
        : extensionOrFilePath
    const found = mime.lookup(ext)
    if (found) return found
    const custom: Record<string, string> = {
        yml: 'application/x-yaml',
        yaml: 'application/x-yaml',
        toml: 'application/toml',
        conf: 'text/plain',
        config: 'text/plain',
        crt: 'application/x-x509-ca-cert',
        key: 'application/x-pem-file',
        pem: 'application/x-pem-file',
    }
    return custom[ext] ?? 'text/plain'
}

const getFileExtension = (filePath: string): string => {
    const ext = extname(filePath)
    return ext.startsWith('.') ? ext.slice(1) : ext
}

/** The default main configuration shown in the config browser: what the live ingress runs (one entrypoint per lane, routes polled from the API). */
function buildDefaultMainConfig(): string {
    const {
        local,
        private: privateLane,
        public: publicLane,
        publicTls,
    } = LANE_ENTRYPOINTS
    return `# Traefik main configuration (mirrors the platform ingress's static arguments)
entryPoints:
  ${local.name}:
    address: ":${String(local.port)}"
  ${privateLane.name}:
    address: ":${String(privateLane.port)}"
  ${publicLane.name}:
    address: ":${String(publicLane.port)}"
  # only when the public lane is \`direct\` with TLS:
  ${publicTls.name}:
    address: ":${String(publicTls.port)}"

providers:
  http:
    endpoint: http://<api>/${TRAEFIK_CONFIG_PATH}
    pollInterval: 5s
`
}

function generateServiceConfigContent(
    config: Pick<
        TraefikServiceConfig,
        | 'serviceId'
        | 'domain'
        | 'fullDomain'
        | 'sslEnabled'
        | 'port'
        | 'configContent'
    >
): string {
    if (config.configContent && typeof config.configContent === 'string')
        return config.configContent
    const host = config.fullDomain || config.domain
    return `# Service configuration for ${config.serviceId}
http:
  routers:
    ${config.serviceId}:
      rule: "Host(\`${host}\`)"
      service: ${config.serviceId}
      ${config.sslEnabled ? 'tls: {}\n      ' : ''}

  services:
    ${config.serviceId}:
      loadBalancer:
        servers:
          - url: "http://localhost:${String(config.port)}"
`
}

const generateSslConfigContent = (cert: {
    domain: string
    id: string
}): string => `# SSL Certificate for ${cert.domain || 'unknown'}
tls:
  certificates:
    - certFile: "/etc/traefik/ssl/${cert.domain || 'unknown'}.crt"
      keyFile: "/etc/traefik/ssl/${cert.domain || 'unknown'}.key"
`

function generateMiddlewareConfigContent(middleware: {
    middlewareName?: string
    name?: string
    middlewareType?: string
    type?: string
    configuration?: unknown
    config?: unknown
}): string {
    const name = middleware.middlewareName ?? middleware.name ?? 'unknown'
    const type = middleware.middlewareType ?? middleware.type ?? 'unknown'
    const configuration = middleware.configuration ?? middleware.config
    if (typeof configuration === 'string' && configuration.length > 0)
        return configuration
    return `# Middleware: ${name}
http:
  middlewares:
    ${name}:
      ${type}:
        # Configuration for ${name}
`
}

const generatePlaceholderServiceConfig = (
    serviceId: string,
    configId: string,
    projectName: string
): string => `# Placeholder service configuration
# Service ID: ${serviceId}...
# Config ID: ${configId}...
# Project: ${projectName}
# Note: This is a placeholder because the actual configuration was not found in the database

http:
  routers:
    ${serviceId}-router:
      rule: "Host(\`placeholder.example.com\`)"
      service: ${serviceId}-service
      # entryPoints: [web]

  services:
    ${serviceId}-service:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
`

const generateMinimalPlaceholderConfig = (
    fileName: string,
    projectName: string
): string => `# Minimal placeholder configuration
# File: ${fileName}
# Project: ${projectName}
# Note: This is a placeholder because the configuration could not be parsed or found

http:
  routers:
    placeholder-router:
      rule: "Host(\`placeholder.example.com\`)"
      service: placeholder-service

  services:
    placeholder-service:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
`

export function makeTraefikFileSystem(
    env: { readonly basePath: string; readonly backupPath: string },
    repository: TraefikRepositoryShape
): TraefikFileSystemShape {
    let paths = pathsFor(env)

    // ── conventions ──────────────────────────────────────────────────────────────────────────────────────────────────
    const sanitizeFileName = (name: string): string =>
        name.replace(/[^a-zA-Z0-9\-_.]/g, '_').toLowerCase()
    const sanitizeDomainName = sanitizeFileName
    const calculateChecksum = (content: string): string =>
        crypto.createHash('sha256').update(content, 'utf8').digest('hex')

    const generateServiceConfigFileName = (
        serviceId: string,
        configId: string
    ): string =>
        `${NAMING.serviceConfigPrefix}-${serviceId.slice(0, 8)}-${configId.slice(0, 8)}.${NAMING.fileExtension}`
    const generateMiddlewareFileName = (
        middlewareName: string,
        middlewareId: string
    ): string =>
        `${NAMING.middlewarePrefix}-${sanitizeFileName(middlewareName)}-${middlewareId.slice(0, 8)}.${NAMING.fileExtension}`
    const generateSSLCertificateFileName = (
        domain: string,
        certificateId: string
    ): string =>
        `${NAMING.sslPrefix}-${sanitizeDomainName(domain)}-${certificateId.slice(0, 8)}.${NAMING.fileExtension}`

    const parseServiceConfigFileName = (
        fileName: string
    ): ParsedServiceConfigFileName | null => {
        const match = new RegExp(
            `^${NAMING.serviceConfigPrefix}-(\\w{8})-(\\w{8})\\.${NAMING.fileExtension}$`
        ).exec(fileName)
        return match?.[1] && match[2]
            ? { serviceId: match[1], configId: match[2] }
            : null
    }

    // ── virtual filesystem reads ─────────────────────────────────────────────────────────────────────────────────────
    const fileItem = (
        name: string,
        path: string,
        content: string,
        lastModified: string,
        extension: string | undefined
    ): VirtualFileItem => ({
        name,
        path,
        type: 'file',
        size: Buffer.byteLength(content, 'utf8'),
        lastModified,
        extension,
        isReadable: true,
        isWritable: true,
        content,
    })

    const getVirtualMainConfig = Effect.suspend(() =>
        repository.getAllStaticFiles()
    ).pipe(
        Effect.map((files) => {
            const main = files.find((f) => f.fileName === 'traefik.yml')
            return typeof main?.fileContent === 'string'
                ? main.fileContent
                : buildDefaultMainConfig()
        }),
        // A database that cannot answer still shows the default configuration.
        Effect.catch(() => Effect.succeed(buildDefaultMainConfig()))
    )

    const buildVirtualProjectTree = (
        projectName: string
    ): Effect.Effect<VirtualDirectoryTree, StorageFailure> =>
        Effect.gen(function* () {
            const treePath = `/dynamic/projects/${projectName}`
            const projectId = yield* repository.getProjectIdByName(projectName)
            if (!projectId) {
                yield* Effect.logWarning(
                    `Project not found in database: ${projectName}`
                )
                return {
                    name: projectName,
                    path: treePath,
                    files: [],
                    subdirectories: [],
                }
            }
            const serviceConfigs =
                yield* repository.getServiceConfigsByProject(projectId)
            if (serviceConfigs.length === 0) {
                yield* Effect.logWarning(
                    `No Traefik service configurations found for project: ${projectName} (ID: ${projectId})`
                )
            }
            const files = serviceConfigs.map((config) => {
                const fileName = generateServiceConfigFileName(
                    config.serviceId,
                    config.id
                )
                // Service configs of the traefik-service schema have no stored configuration; show their essentials.
                const content = `# Service Config for ${config.serviceId || 'unknown'}\ndomain: ${config.domain || 'unknown'}\nfullDomain: ${config.fullDomain || 'unknown'}\nsslEnabled: ${String(config.sslEnabled ?? false)}`
                return fileItem(
                    fileName,
                    `${treePath}/${fileName}`,
                    content,
                    config.updatedAt?.toISOString() ?? new Date().toISOString(),
                    '.yml'
                )
            })
            return {
                name: projectName,
                path: treePath,
                files: files.sort((a, b) => a.name.localeCompare(b.name)),
                subdirectories: [],
            }
        })

    /** Files under one of the flat virtual directories (/ssl, /middleware, /static). A failed table lists nothing. */
    const getVirtualFilesForPath = (
        path: string
    ): Effect.Effect<VirtualFileItem[]> => {
        const orNothing = (
            what: string,
            run: Effect.Effect<VirtualFileItem[], StorageFailure>
        ) =>
            run.pipe(
                Effect.catch((error) =>
                    Effect.logError(
                        `Error getting ${what}: ${error.message}`
                    ).pipe(Effect.as([] as VirtualFileItem[]))
                )
            )
        switch (path) {
            case '/ssl':
                return orNothing(
                    'SSL certificates',
                    repository.getAllNewSslCertificates().pipe(
                        Effect.map((certs) =>
                            certs.map((cert) => {
                                const fileName = generateSSLCertificateFileName(
                                    cert.domain,
                                    cert.id
                                )
                                return fileItem(
                                    fileName,
                                    `/ssl/${fileName}`,
                                    generateSslConfigContent(cert),
                                    cert.updatedAt?.toISOString() ??
                                        new Date().toISOString(),
                                    '.yml'
                                )
                            })
                        )
                    )
                )
            case '/middleware':
                return orNothing(
                    'middlewares',
                    repository.getAllNewMiddleware().pipe(
                        Effect.map((middlewares) =>
                            middlewares.map((m) => {
                                const fileName = generateMiddlewareFileName(
                                    m.middlewareName,
                                    m.id
                                )
                                return fileItem(
                                    fileName,
                                    `/middleware/${fileName}`,
                                    generateMiddlewareConfigContent(m),
                                    m.updatedAt.toISOString(),
                                    '.yml'
                                )
                            })
                        )
                    )
                )
            case '/static':
                return orNothing(
                    'static files',
                    repository.getAllStaticFiles().pipe(
                        Effect.map((staticFiles) =>
                            staticFiles.map((sf) => {
                                const extension = sf.fileName.split('.').pop()
                                return fileItem(
                                    sf.fileName,
                                    sf.relativePath,
                                    sf.fileContent,
                                    sf.updatedAt.toISOString(),
                                    extension ? `.${extension}` : undefined
                                )
                            })
                        )
                    )
                )
            default:
                return Effect.succeed([])
        }
    }

    const buildVirtualDirectoryTree = (
        path: string
    ): Effect.Effect<VirtualDirectoryTree, StorageFailure> =>
        Effect.gen(function* () {
            const name =
                path === '/' ? 'traefik-configs' : (path.split('/').pop() ?? '')
            const files: VirtualFileItem[] = []
            const subdirectories: VirtualDirectoryTree[] = []

            if (path === '/') {
                for (const child of [
                    '/dynamic',
                    '/static',
                    '/ssl',
                    '/middleware',
                    '/backups',
                ]) {
                    subdirectories.push(yield* buildVirtualDirectoryTree(child))
                }
                const mainConfig = yield* getVirtualMainConfig
                files.push(
                    fileItem(
                        'traefik.yml',
                        '/traefik.yml',
                        mainConfig,
                        new Date().toISOString(),
                        '.yml'
                    )
                )
            } else if (path === '/dynamic') {
                subdirectories.push(
                    yield* buildVirtualDirectoryTree('/dynamic/projects'),
                    yield* buildVirtualDirectoryTree('/dynamic/standalone')
                )
            } else if (path === '/dynamic/projects') {
                for (const project of yield* repository.getAllProjects())
                    subdirectories.push(
                        yield* buildVirtualProjectTree(project.name)
                    )
            } else if (path.startsWith('/dynamic/projects/')) {
                const projectName = path.split('/')[3]
                if (projectName)
                    return yield* buildVirtualProjectTree(projectName)
            } else {
                files.push(...(yield* getVirtualFilesForPath(path)))
            }

            return {
                name,
                path,
                files: files.sort((a, b) => a.name.localeCompare(b.name)),
                subdirectories: subdirectories.sort((a, b) =>
                    a.name.localeCompare(b.name)
                ),
            }
        })

    /** The configs of a project's folder, found by the 8-char id prefixes in the file name. */
    const findProjectConfig = (
        projectName: string,
        parsed: ParsedServiceConfigFileName
    ) =>
        Effect.gen(function* () {
            const projectId = yield* repository.getProjectIdByName(projectName)
            if (!projectId)
                return yield* new TraefikFileNotFound({
                    filePath: `/dynamic/projects/${projectName}`,
                })
            const configs =
                yield* repository.getServiceConfigsByProject(projectId)
            return configs.find(
                (c) =>
                    c.serviceId.startsWith(parsed.serviceId) &&
                    c.id.startsWith(parsed.configId)
            )
        })

    const getVirtualFileContent = (
        filePath: string
    ): Effect.Effect<string, Failure> =>
        Effect.gen(function* () {
            if (filePath === '/traefik.yml' || filePath === 'traefik.yml')
                return yield* getVirtualMainConfig

            if (
                filePath.includes('/dynamic/projects/') &&
                filePath.endsWith('.yml')
            ) {
                const pathParts = filePath.split('/')
                const fileName = pathParts[pathParts.length - 1] ?? ''
                const projectName = pathParts[3] ?? ''
                const parsed = fileName
                    ? parseServiceConfigFileName(fileName)
                    : null
                if (parsed && projectName) {
                    const config = yield* findProjectConfig(projectName, parsed)
                    // A config that was removed since the listing still opens as a placeholder.
                    return config
                        ? generateServiceConfigContent(config)
                        : generatePlaceholderServiceConfig(
                              parsed.serviceId,
                              parsed.configId,
                              projectName
                          )
                }
                return generateMinimalPlaceholderConfig(
                    fileName,
                    projectName || 'unknown'
                )
            }

            if (filePath.includes('/ssl/') && filePath.endsWith('.yml')) {
                const fileName = filePath.split('/').pop()
                if (fileName?.startsWith('ssl-')) {
                    const cert =
                        (yield* repository.getAllNewSslCertificates()).find(
                            (c) => filePath.includes(c.domain.replace('.', '_'))
                        )
                    if (cert) return generateSslConfigContent(cert)
                }
            }

            if (
                filePath.includes('/middleware/') &&
                filePath.endsWith('.yml')
            ) {
                const middleware =
                    (yield* repository.getAllNewMiddleware()).find((m) =>
                        filePath.includes(m.middlewareName)
                    )
                if (middleware)
                    return generateMiddlewareConfigContent(middleware)
            }

            if (filePath.includes('/static/') && filePath.endsWith('.yml')) {
                const staticFile = (yield* repository.getAllStaticFiles()).find(
                    (sf) => filePath.includes(sf.fileName)
                )
                if (staticFile) return staticFile.fileContent
            }

            return yield* new TraefikFileNotFound({ filePath })
        })

    const virtualFileExists = (filePath: string): Effect.Effect<boolean> =>
        getVirtualFileContent(filePath).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false))
        )

    // ── virtual filesystem writes ────────────────────────────────────────────────────────────────────────────────────
    const staticFileRecord = (
        fileName: string,
        relativePath: string,
        content: string
    ) => ({
        fileName,
        relativePath,
        fileContent: content,
        mimeType: 'application/x-yaml',
        fileSize: Buffer.byteLength(content, 'utf8'),
        isPublic: false,
        projectId: null,
    })

    const writeVirtualFileContent = (
        filePath: string,
        content: string
    ): Effect.Effect<void, StorageFailure | TraefikFileWriteRefused> =>
        Effect.gen(function* () {
            const normalizedPath = filePath.startsWith('/')
                ? filePath
                : `/${filePath}`

            if (
                normalizedPath === '/traefik.yml' ||
                filePath === 'traefik.yml'
            ) {
                yield* repository.createStaticFile(
                    staticFileRecord('traefik.yml', normalizedPath, content)
                )
                return
            }

            if (
                (normalizedPath.includes('/dynamic/projects/') ||
                    filePath.includes('dynamic/projects/')) &&
                filePath.endsWith('.yml')
            ) {
                const pathParts = normalizedPath
                    .split('/')
                    .filter((part) => part.length > 0)
                const [fileName, projectName] =
                    pathParts[0] === 'dynamic' && pathParts[1] === 'projects'
                        ? [pathParts[3], pathParts[2]]
                        : [
                              pathParts[pathParts.length - 1],
                              pathParts[pathParts.length - 2],
                          ]
                if (
                    fileName &&
                    projectName &&
                    parseServiceConfigFileName(fileName)
                ) {
                    // Service configs have no content column of their own: they are kept as static files.
                    yield* repository.createStaticFile(
                        staticFileRecord(fileName, normalizedPath, content)
                    )
                    return
                }
            }

            if (normalizedPath.includes('/static/')) {
                yield* repository.createStaticFile(
                    staticFileRecord(
                        normalizedPath.split('/').pop() ?? 'unknown',
                        normalizedPath,
                        content
                    )
                )
                return
            }

            return yield* new TraefikFileWriteRefused({ filePath })
        })

    const deleteVirtualFile = (
        filePath: string
    ): Effect.Effect<void, Failure> =>
        Effect.gen(function* () {
            if (
                filePath.includes('/dynamic/projects/') &&
                filePath.endsWith('.yml')
            ) {
                const pathParts = filePath.split('/')
                const fileName = pathParts[pathParts.length - 1] ?? ''
                const projectName = pathParts[3] ?? ''
                const parsed = fileName
                    ? parseServiceConfigFileName(fileName)
                    : null
                if (parsed && projectName) {
                    const config = yield* findProjectConfig(projectName, parsed)
                    if (config) {
                        yield* repository.deleteServiceConfig(config.id)
                        return
                    }
                }
            }
            if (filePath.includes('/static/')) {
                const staticFile = (yield* repository.getAllStaticFiles()).find(
                    (sf) => sf.relativePath === filePath
                )
                if (staticFile) {
                    yield* repository.deleteStaticFile(staticFile.id)
                    return
                }
            }
            return yield* new TraefikFileNotFound({ filePath })
        })

    const createVirtualBackup = (
        filePath: string,
        content: string
    ): Effect.Effect<{ backupPath: string }, StorageFailure> =>
        Effect.gen(function* () {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const fileName = filePath.split('/').pop() ?? 'unknown'
            yield* repository.createBackup({
                backupName: `${fileName}.backup.${timestamp}`,
                backupType: 'file',
                originalPath: filePath,
                backupContent: content,
                compressionType: null,
                backupSize: Buffer.byteLength(content, 'utf8'),
                metadata: { originalFileName: fileName },
                projectId: null,
            })
            return { backupPath: `/backups/${fileName}.backup.${timestamp}` }
        })

    // ── listings ─────────────────────────────────────────────────────────────────────────────────────────────────────
    const getAllVirtualConfigFiles = (
        directoryPath?: string
    ): Effect.Effect<string[], StorageFailure> =>
        Effect.gen(function* () {
            const files: string[] = []

            for (const config of yield* repository.getAllServiceConfigs()) {
                // One config whose service or project vanished must not hide the others.
                const projectName = yield* Effect.gen(function* () {
                    const service = yield* repository.getServiceById(
                        config.serviceId
                    )
                    if (!service) {
                        yield* Effect.logWarning(
                            `Service ${config.serviceId} not found for config ${config.id}`
                        )
                        return undefined
                    }
                    const project = yield* repository.getProjectById(
                        service.projectId
                    )
                    if (!project) {
                        yield* Effect.logWarning(
                            `Project ${service.projectId} not found for service ${config.serviceId}`
                        )
                        return undefined
                    }
                    return project.name
                }).pipe(
                    Effect.catch((error) =>
                        Effect.logError(
                            `Failed to process service config ${config.id}: ${error.message}`
                        ).pipe(Effect.as(undefined))
                    )
                )
                if (projectName !== undefined)
                    files.push(
                        `/dynamic/projects/${projectName}/${generateServiceConfigFileName(config.serviceId, config.id)}`
                    )
            }

            for (const cert of yield* repository.getAllNewSslCertificates())
                files.push(
                    `/ssl/${generateSSLCertificateFileName(cert.domain, cert.id)}`
                )
            for (const m of yield* repository.getAllNewMiddleware())
                files.push(
                    `/middleware/${generateMiddlewareFileName(m.middlewareName, m.id)}`
                )
            for (const sf of yield* repository.getAllStaticFiles())
                files.push(sf.relativePath)

            return files.filter(
                (file) => !directoryPath || file.startsWith(directoryPath)
            )
        })

    const getVirtualProjectConfigFiles = (
        projectName: string
    ): Effect.Effect<string[], StorageFailure> =>
        Effect.gen(function* () {
            const projectId = yield* repository.getProjectIdByName(projectName)
            if (!projectId) {
                yield* Effect.logWarning(`Project not found: ${projectName}`)
                return []
            }
            const configs =
                yield* repository.getServiceConfigsByProject(projectId)
            return configs.map(
                (config) =>
                    `/dynamic/projects/${projectName}/${generateServiceConfigFileName(config.serviceId, config.id)}`
            )
        })

    // ── file operations that report instead of failing ───────────────────────────────────────────────────────────────
    const reported =
        (filePath: string, action: string) =>
        (error: {
            readonly message: string
        }): Effect.Effect<FileOperationResult> =>
            Effect.logError(
                `Failed to ${action} virtual file ${filePath}: ${error.message}`
            ).pipe(
                Effect.as({
                    success: false,
                    filePath,
                    action: 'error',
                    message: error.message,
                } satisfies FileOperationResult)
            )

    const getFileContent: TraefikFileSystemShape['getFileContent'] = (
        filePath
    ) =>
        getVirtualFileContent(filePath).pipe(
            Effect.map((content) => ({
                content,
                size: Buffer.byteLength(content, 'utf8'),
                mimeType: getMimeType(getFileExtension(filePath)),
            }))
        )

    return {
        getFileSystemPaths: () => ({ ...paths }),
        getNamingConventions: () => ({ ...NAMING }),
        generateServiceConfigFileName,
        generateServiceConfigPath: (serviceId, configId, projectName) => {
            const fileName = generateServiceConfigFileName(serviceId, configId)
            return projectName
                ? join(paths.projectsPath, projectName, fileName)
                : join(paths.standalonePath, fileName)
        },
        generateMiddlewareFileName,
        generateMiddlewarePath: (
            middlewareName,
            middlewareId,
            isGlobal = false
        ) =>
            join(
                paths.middlewarePath,
                isGlobal ? 'global' : 'local',
                generateMiddlewareFileName(middlewareName, middlewareId)
            ),
        generateSSLCertificateFileName,
        generateSSLCertificatePath: (domain, certificateId) =>
            join(
                paths.sslPath,
                generateSSLCertificateFileName(domain, certificateId)
            ),
        generateBackupPath: (originalPath) =>
            join(
                paths.backupPath,
                `${basename(originalPath)}.${NAMING.backupSuffix}.${new Date().toISOString().replace(/[:.]/g, '-')}`
            ),
        sanitizeFileName,
        sanitizeDomainName,
        parseServiceConfigFileName,
        isProjectFile: (filePath, projectName) =>
            filePath.startsWith(join(paths.projectsPath, projectName)),
        extractProjectFromPath: (filePath) => {
            if (!filePath.startsWith(paths.projectsPath)) return null
            return relative(paths.projectsPath, filePath).split('/')[0] ?? null
        },
        calculateChecksum,
        setBasePaths: (next) => {
            paths = pathsFor(next)
        },

        getTraefikFileSystem: (path) =>
            Effect.logDebug(
                `Getting virtual Traefik file system for path: ${path ?? '/'}`
            ).pipe(Effect.andThen(buildVirtualDirectoryTree(path ?? '/'))),
        getProjectFileSystem: (projectName) =>
            buildVirtualProjectTree(projectName),
        getFileContent,
        downloadFile: (filePath) =>
            getFileContent(filePath).pipe(
                Effect.map((content) => ({
                    filename: filePath.split('/').pop() ?? 'unknown',
                    ...content,
                }))
            ),
        listProjects: () =>
            repository
                .getAllProjects()
                .pipe(
                    Effect.map((projects) => projects.map((p) => p.name).sort())
                ),

        writeFile: (filePath, content) =>
            Effect.gen(function* () {
                const existed = yield* virtualFileExists(filePath)
                yield* writeVirtualFileContent(filePath, content)
                return {
                    success: true,
                    filePath,
                    action: existed ? 'updated' : 'created',
                    size: Buffer.byteLength(content, 'utf8'),
                    checksum: calculateChecksum(content),
                } satisfies FileOperationResult
            }).pipe(Effect.catch(reported(filePath, 'write'))),

        deleteFile: (filePath) =>
            Effect.gen(function* () {
                if (!(yield* virtualFileExists(filePath))) {
                    return {
                        success: true,
                        filePath,
                        action: 'deleted',
                        message: 'Virtual file did not exist',
                    } satisfies FileOperationResult
                }
                yield* deleteVirtualFile(filePath)
                return {
                    success: true,
                    filePath,
                    action: 'deleted',
                } satisfies FileOperationResult
            }).pipe(Effect.catch(reported(filePath, 'delete'))),

        backupFile: (filePath) =>
            Effect.gen(function* () {
                if (!(yield* virtualFileExists(filePath))) {
                    return {
                        success: true,
                        filePath,
                        action: 'read',
                        message:
                            'Virtual file does not exist, no backup needed',
                    } satisfies FileOperationResult
                }
                const content = yield* getVirtualFileContent(filePath)
                const backup = yield* createVirtualBackup(filePath, content)
                return {
                    success: true,
                    filePath: backup.backupPath,
                    action: 'created',
                    size: Buffer.byteLength(content, 'utf8'),
                } satisfies FileOperationResult
            }).pipe(Effect.catch(reported(filePath, 'backup'))),

        getAllConfigFiles: (directoryPath) =>
            getAllVirtualConfigFiles(directoryPath).pipe(
                Effect.catch((error) =>
                    Effect.logError(
                        `Failed to get virtual config files: ${error.message}`
                    ).pipe(Effect.as([] as string[]))
                )
            ),
        getProjectConfigFiles: (projectName) =>
            getVirtualProjectConfigFiles(projectName).pipe(
                Effect.catch((error) =>
                    Effect.logError(
                        `Failed to get virtual project config files for ${projectName}: ${error.message}`
                    ).pipe(Effect.as([] as string[]))
                )
            ),
        fileExists: virtualFileExists,
        calculateFileChecksum: (filePath) =>
            getVirtualFileContent(filePath).pipe(Effect.map(calculateChecksum)),
        ensureDirectoryExists: (dirPath) =>
            Effect.logDebug(`Virtual directory ensured: ${dirPath}`),
        initializeFileSystemStructure: () =>
            Effect.logInfo(
                'Virtual Traefik filesystem structure initialized (database-driven)'
            ),
    }
}

export class TraefikFileSystemService extends Context.Service<
    TraefikFileSystemService,
    TraefikFileSystemShape
>()('shared/TraefikFileSystemService') {}
