'use client'

import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { PERMISSIONS } from '@deployer/auth/authz'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@deployer/ui/components/shadcn/table'

import { PageErrorState, PageHeader } from '@/components/dashboard'
import {
    useDeleteRole,
    useManagedRoles,
    type ManagedRole,
} from '@/domains/roles/hooks'
import { useCan } from '@/lib/access/permissions'
import { getErrorMessage } from '@/lib/orpc/typed-errors'

import { RoleDialog, type PermissionGroup } from './_components/role-dialog'

/**
 * Settings → Roles (`SEC-054`).
 *
 * The catalogue is data: the API seeds the built-ins and the web renders whatever the deployment reports. Custom roles
 * are editable here, capped by the server (rank below yours, permissions you already hold), so a role editor cannot
 * escalate through this page.
 */
export default function SettingsRolesPage() {
    const canWrite = useCan('role:write')
    const query = useManagedRoles()
    const remove = useDeleteRole()
    const [creating, setCreating] = useState(false)
    const [editing, setEditing] = useState<ManagedRole | null>(null)

    const roles = query.data?.data ?? []

    /** The catalog grouped by resource, with the action's own description as the hint. */
    const groups = useMemo<PermissionGroup[]>(() => {
        const byResource = new Map<
            string,
            { key: string; description: string }[]
        >()
        for (const [key, definition] of Object.entries(PERMISSIONS)) {
            const resource = key.slice(0, key.indexOf(':'))
            const list = byResource.get(resource) ?? []
            list.push({ key, description: definition.description })
            byResource.set(resource, list)
        }
        return [...byResource.entries()]
            .map(([resource, permissions]) => ({ resource, permissions }))
            .sort((a, b) => a.resource.localeCompare(b.resource))
    }, [])

    const drop = (role: ManagedRole) => {
        remove.mutate(
            { params: { id: role.id } },
            {
                onSuccess: () => {
                    toast.success(`Deleted ${role.label}`)
                    void query.refetch()
                },
                onError: (error) => {
                    toast.error(getErrorMessage(error))
                },
            }
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Settings"
                title="Roles"
                description="What each platform role can do. Built-in roles come from the code and change by re-seeding; custom roles are editable here and can only be narrower than the editor."
                badge={<Badge variant="secondary">{roles.length} roles</Badge>}
                actions={
                    canWrite ? (
                        <Button
                            onClick={() => {
                                setCreating(true)
                            }}
                        >
                            New role
                        </Button>
                    ) : undefined
                }
            />

            {query.isError ? (
                <PageErrorState
                    title="Could not read the role catalogue"
                    message={getErrorMessage(query.error)}
                    onRetry={() => void query.refetch()}
                />
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Catalogue</CardTitle>
                        <CardDescription>
                            Ordered strongest first. `rank` is what answers
                            &quot;may this actor act on that account&quot;.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        {query.isLoading ? (
                            <div className="space-y-2 p-6">
                                {Array.from({ length: 4 }, (_, index) => (
                                    <Skeleton
                                        key={index}
                                        className="h-10 w-full"
                                    />
                                ))}
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Role</TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Rank</TableHead>
                                        <TableHead>Permissions</TableHead>
                                        <TableHead className="text-right">
                                            Actions
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {roles.map((role) => (
                                        <TableRow key={role.id}>
                                            <TableCell>
                                                <span className="font-medium">
                                                    {role.label}
                                                </span>
                                                {role.isSystem ? (
                                                    <Badge
                                                        variant="outline"
                                                        className="ml-2"
                                                    >
                                                        built-in
                                                    </Badge>
                                                ) : null}
                                                {role.description ===
                                                null ? null : (
                                                    <span className="text-muted-foreground block text-xs">
                                                        {role.description}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {role.name}
                                            </TableCell>
                                            <TableCell>{role.rank}</TableCell>
                                            <TableCell className="text-muted-foreground text-xs">
                                                {role.permissions.length === 0
                                                    ? 'none'
                                                    : `${String(role.permissions.length)} granted`}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {canWrite && !role.isSystem ? (
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => {
                                                                setEditing(role)
                                                            }}
                                                        >
                                                            Edit
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            disabled={
                                                                remove.isPending
                                                            }
                                                            onClick={() => {
                                                                drop(role)
                                                            }}
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">
                                                        re-seeded from code
                                                    </span>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}

            {creating ? (
                <RoleDialog
                    groups={groups}
                    onClose={() => {
                        setCreating(false)
                    }}
                />
            ) : null}
            {editing === null ? null : (
                <RoleDialog
                    role={editing}
                    groups={groups}
                    onClose={() => {
                        setEditing(null)
                    }}
                />
            )}
        </div>
    )
}
