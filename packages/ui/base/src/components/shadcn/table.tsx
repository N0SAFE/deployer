"use client"

import * as React from "react"

import { cn } from "@repo/ui/lib/utils"

function Table({
  className,
  stickyHeader = false,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  /** Pin the header row while the table body scrolls (give the container a max-height). */
  stickyHeader?: boolean
  containerClassName?: string
}) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto",
        stickyHeader && "max-h-[70vh] overflow-y-auto",
        containerClassName
      )}
    >
      <table
        data-slot="table"
        data-sticky-header={stickyHeader || undefined}
        className={cn(
          "w-full caption-bottom text-[0.8125rem] data-[sticky-header]:[&_thead_th]:sticky data-[sticky-header]:[&_thead_th]:top-0 data-[sticky-header]:[&_thead_th]:z-10 data-[sticky-header]:[&_thead_th]:bg-card",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-10 px-3 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 data-[numeric]:text-right data-[numeric]:tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-[0.8125rem] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
