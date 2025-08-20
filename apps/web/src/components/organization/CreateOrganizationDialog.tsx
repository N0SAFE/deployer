'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { Plus, Loader2 } from 'lucide-react'
import { useCreateOrganization } from '@/hooks/useTeams'

interface CreateOrganizationDialogProps {
  children?: React.ReactNode
  className?: string
}

export default function CreateOrganizationDialog({ 
  children,
  className 
}: CreateOrganizationDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  
  const createOrganization = useCreateOrganization()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return

    try {
      await createOrganization.mutateAsync({
        name: name.trim(),
        slug: slug.trim(),
      })
      setOpen(false)
      setName('')
      setSlug('')
    } catch {
      // Error handling is done in the hook
    }
  }

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value)
    if (!slug || slug === name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')) {
      setSlug(value.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, ''))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button className={className}>
            <Plus className="h-4 w-4 mr-2" />
            Create Organization
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Create a new organization to collaborate with your team on projects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                placeholder="My Organization"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="slug">Organization Slug</Label>
              <Input
                id="slug"
                placeholder="my-organization"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                This will be used in URLs and must be unique
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !slug.trim() || createOrganization.isPending}
            >
              {createOrganization.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Create Organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}