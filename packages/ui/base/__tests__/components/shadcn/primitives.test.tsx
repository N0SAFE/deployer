import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, buttonVariants } from '../../../src/components/shadcn/button'
import { Badge, badgeVariants } from '../../../src/components/shadcn/badge'
import { Skeleton, skeletonVariants } from '../../../src/components/shadcn/skeleton'
import { Spinner } from '../../../src/components/shadcn/spinner'
import { Table, TableCell, TableBody, TableRow } from '../../../src/components/shadcn/table'

describe('Button', () => {
    it('is unchanged without loading', () => {
        render(<Button>Save</Button>)
        const b = screen.getByRole('button', { name: 'Save' })
        expect(b).not.toBeDisabled()
        expect(b).not.toHaveAttribute('aria-busy')
    })
    it('loading disables, sets aria-busy and shows a status spinner', () => {
        render(<Button loading>Save</Button>)
        const b = screen.getByRole('button')
        expect(b).toBeDisabled()
        expect(b).toHaveAttribute('aria-busy', 'true')
        expect(screen.getByRole('status')).toBeInTheDocument()
    })
    it('forwards aria attributes', () => {
        render(<Button aria-label="Close" />)
        expect(screen.getByLabelText('Close')).toBeInTheDocument()
    })
    it('slots onto its child without loading (Radix Slot needs exactly one child)', () => {
        render(
            <Button asChild>
                <a href="/target">Go</a>
            </Button>,
        )
        const link = screen.getByRole('link', { name: 'Go' })
        expect(link).toHaveAttribute('href', '/target')
        expect(link).toHaveAttribute('data-slot', 'button')
    })
    it('renders both the spinner and the child when loading', () => {
        render(<Button loading>Save</Button>)
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.getByRole('button')).toHaveTextContent('Save')
    })
    it('resolves every size to a height class', () => {
        for (const s of ['default', 'xs', 'sm', 'lg'] as const) expect(buttonVariants({ size: s })).toMatch(/\bh-\d/)
    })
})

describe('Badge', () => {
    it.each(['success', 'warning', 'info', 'destructive'] as const)('%s variant resolves', (v) => {
        expect(badgeVariants({ variant: v })).toContain('text-')
    })
    it.each(['success-subtle', 'warning-subtle', 'danger-subtle', 'info-subtle', 'neutral'] as const)(
        '%s uses the semantic tokens',
        (v) => {
            const root = v.replace('-subtle', '')
            const cls = badgeVariants({ variant: v })
            expect(cls).toContain(`text-${root}`)
            expect(cls).toContain(`bg-${root}-bg`)
            expect(cls).toContain(`border-${root}-border`)
        }
    )
    it('renders text at least 12px', () => {
        render(<Badge>ok</Badge>)
        expect(screen.getByText('ok').className).not.toMatch(/text-\[0\.625rem\]|text-\[10px\]/)
    })
})

describe('Skeleton', () => {
    it('is decorative and supports variants', () => {
        const { container } = render(<Skeleton variant="row" />)
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
        expect(skeletonVariants({ variant: 'text' })).toContain('h-4')
        expect(skeletonVariants({ variant: 'card' })).toContain('h-32')
    })
})

describe('Spinner', () => {
    it('exposes a labelled status', () => {
        render(<Spinner label="Deploying" />)
        expect(screen.getByRole('status')).toHaveTextContent('Deploying')
    })
})

describe('Table', () => {
    it('marks sticky headers and numeric cells', () => {
        const { container } = render(
            <Table stickyHeader>
                <TableBody>
                    <TableRow>
                        <TableCell data-numeric>3</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        )
        expect(container.querySelector('table')).toHaveAttribute('data-sticky-header', 'true')
        expect(container.querySelector('td')?.className).toContain('data-[numeric]:tabular-nums')
    })
})
