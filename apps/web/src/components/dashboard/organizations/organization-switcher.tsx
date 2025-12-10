'use client'

import { useState, type JSX } from 'react'
import type { Organization } from 'better-auth/plugins'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@repo/ui/components/shadcn/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@repo/ui/components/shadcn/popover'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OrganizationSwitcherProps {
  organizations: Organization[]
  activeOrganization?: Organization | null
  isLoading?: boolean
  onSelectOrganization: (org: Organization) => void
  onCreateOrganization?: () => void
  className?: string
}

export function OrganizationSwitcher({
  organizations,
  activeOrganization,
  isLoading = false,
  onSelectOrganization,
  onCreateOrganization,
  className,
}: OrganizationSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select organization"
          className={cn('w-[220px] justify-between', className)}
          disabled={isLoading}
        >
          {activeOrganization ? (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage
                  src={activeOrganization.logo ?? undefined}
                  alt={activeOrganization.name}
                />
                <AvatarFallback className="text-[10px]">
                  {getInitials(activeOrganization.name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{activeOrganization.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span>Select organization</span>
            </div>
          )}
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search organization..." />
          <CommandList>
            <CommandEmpty>No organization found.</CommandEmpty>
            <CommandGroup heading="Organizations">
              {organizations.map((org) => (
                <CommandItem
                  key={org.id}
                  onSelect={() => {
                    onSelectOrganization(org)
                    setOpen(false)
                  }}
                  className="flex items-center gap-2"
                >
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={org.logo ?? undefined} alt={org.name} />
                    <AvatarFallback className="text-[10px]">
                      {getInitials(org.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{org.name}</span>
                  {activeOrganization?.id === org.id && (
                    <Check className="ml-auto h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreateOrganization && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onCreateOrganization()
                      setOpen(false)
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Organization
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
