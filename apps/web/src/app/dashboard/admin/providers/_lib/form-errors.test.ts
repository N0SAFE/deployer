import { describe, expect, it } from 'vitest'
import z from 'zod/v4'
import { fieldErrors } from './form-errors'

const schema = z.object({ name: z.string().min(1, 'Name is required'), url: z.string().url('Must be a valid URL') })

describe('fieldErrors', () => {
  it('is empty for valid values', () => {
    expect(fieldErrors(schema, { name: 'a', url: 'https://x.io' })).toEqual({})
  })
  it('maps the first message to each field', () => {
    expect(fieldErrors(schema, { name: '', url: 'nope' })).toEqual({ name: 'Name is required', url: 'Must be a valid URL' })
  })
})
