import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  }

  try {
    return new URL(pathOrUrl).toString()
  } catch {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    return new URL(pathOrUrl, baseUrl).toString()
  }
}
