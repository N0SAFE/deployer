"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/shadcn/dropdown-menu"
import { Button } from "@repo/ui/components/shadcn/button"
import { Badge } from "@repo/ui/components/shadcn/badge"
import { LogOut, User, Mail, Shield, ChevronUp } from "lucide-react"
import { useRouter } from "next/navigation"

import { signOut, useSession } from "@/lib/auth"

interface UserProfileFooterProps {
  isCollapsed?: boolean
}

function ProfileAvatar({
  src,
  alt,
  initials,
  size = "md",
}: {
  src?: string | null
  alt?: string | null
  initials: string
  size?: "sm" | "md" | "lg"
}) {
  const sizeClasses = {
    sm: "h-7 w-7 text-xs",
    md: "h-8 w-8 text-sm",
    lg: "h-10 w-10 text-base",
  }[size]
  const dimension = {
    sm: 28,
    md: 32,
    lg: 40,
  }[size]

  return (
    <div
      className={`relative overflow-hidden rounded-full bg-primary/10 text-muted-foreground ${sizeClasses}`}
      aria-label={alt ?? "User"}
      role="img"
    >
      {src ? (
        <Image
          src={src}
          alt={alt ?? "User"}
          width={dimension}
          height={dimension}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center uppercase">{initials}</span>
      )}
    </div>
  )
}

export function UserProfileFooter({ isCollapsed = false }: UserProfileFooterProps) {
  const { data: session, isPending } = useSession()
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push("/auth/signin")
          },
        },
      })
    } catch (error) {
      console.error("Sign out error", error)
    } finally {
      setIsSigningOut(false)
    }
  }

  if (isPending) {
    return (
      <div className={`p-3 ${isCollapsed ? "flex justify-center" : "flex items-center gap-3"}`}>
        <div className="animate-pulse">
          <div className={`bg-muted rounded-full ${isCollapsed ? "h-8 w-8" : "h-10 w-10"}`} />
        </div>
      </div>
    )
  }

  if (!session?.user) {
    return null
  }

  const user = session.user
  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email[0]?.toUpperCase() ?? "U"

  if (isCollapsed) {
    return (
      <div className="p-2 flex justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-accent">
              <ProfileAvatar src={user.image} alt={user.name} initials={initials} size="sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user.name || "User"}</p>
              <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/auth/me" className="flex items-center">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                void handleSignOut()
              }}
              disabled={isSigningOut}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="p-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="w-full h-auto p-2 justify-start hover:bg-accent/50 transition-colors">
            <div className="flex items-center space-x-3 w-full">
              <ProfileAvatar src={user.image} alt={user.name} initials={initials} size="md" />
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{user.name || "User"}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <div className="flex items-center space-x-3">
              <ProfileAvatar src={user.image} alt={user.name} initials={initials} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-none truncate">{user.name || "User"}</p>
                <div className="flex items-center space-x-1 mt-1">
                  <Mail className="h-3 w-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
                <div className="flex items-center space-x-1 mt-1">
                  <Shield className="h-3 w-3 text-green-600" />
                  <Badge variant="secondary" className="text-xs px-1 py-0">
                    Active
                  </Badge>
                </div>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/auth/me" className="flex items-center">
              <User className="mr-2 h-4 w-4" />
              <span>View Profile</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              void handleSignOut()
            }}
            disabled={isSigningOut}
            className="text-red-600 focus:text-red-600 focus:bg-red-50"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
