import { describe, it, expect, vi } from 'vitest'
import { tryCatch, tryCatchSync, tryCatchAll } from '../server'

describe('Server Utils', () => {
  describe('tryCatch', () => {
    it('should return the result when function succeeds', async () => {
      const successFn = vi.fn().mockResolvedValue('success')
      const result = await tryCatch(successFn)
      
      expect(result).toBe('success')
      expect(successFn).toHaveBeenCalledOnce()
    })

    it('should return null when function throws', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('test error'))
      const catchFn = vi.fn()
      
      const result = await tryCatch(failFn, catchFn)
      
      expect(result).toBeNull()
      expect(failFn).toHaveBeenCalledOnce()
      expect(catchFn).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should work without catch function', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('test error'))
      
      const result = await tryCatch(failFn)
      
      expect(result).toBeNull()
      expect(failFn).toHaveBeenCalledOnce()
    })
  })

  describe('tryCatchSync', () => {
    it('should return the result when function succeeds', () => {
      const successFn = vi.fn().mockReturnValue('success')
      const result = tryCatchSync(successFn)
      
      expect(result).toBe('success')
      expect(successFn).toHaveBeenCalledOnce()
    })

    it('should return null when function throws', () => {
      const failFn = vi.fn().mockImplementation(() => {
        throw new Error('test error')
      })
      const catchFn = vi.fn()
      
      const result = tryCatchSync(failFn, catchFn)
      
      expect(result).toBeNull()
      expect(failFn).toHaveBeenCalledOnce()
      expect(catchFn).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('tryCatchAll', () => {
    it('should return all results when all functions succeed', async () => {
      const fn1 = vi.fn().mockResolvedValue('result1')
      const fn2 = vi.fn().mockResolvedValue('result2')
      const fn3 = vi.fn().mockResolvedValue('result3')
      
      const results = await tryCatchAll([fn1, fn2, fn3])
      
      expect(results).toEqual(['result1', 'result2', 'result3'])
      expect(fn1).toHaveBeenCalledOnce()
      expect(fn2).toHaveBeenCalledOnce()
      expect(fn3).toHaveBeenCalledOnce()
    })

    it('should return null for failed operations', async () => {
      const fn1 = vi.fn().mockResolvedValue('result1')
      const fn2 = vi.fn().mockRejectedValue(new Error('test error'))
      const fn3 = vi.fn().mockResolvedValue('result3')
      const catchFn = vi.fn()
      
      const results = await tryCatchAll([fn1, fn2, fn3], catchFn)
      
      expect(results).toEqual(['result1', null, 'result3'])
      expect(catchFn).toHaveBeenCalledWith(expect.any(Error), 1)
    })

    it('should handle all failures', async () => {
      const fn1 = vi.fn().mockRejectedValue(new Error('error1'))
      const fn2 = vi.fn().mockRejectedValue(new Error('error2'))
      const catchFn = vi.fn()
      
      const results = await tryCatchAll([fn1, fn2], catchFn)
      
      expect(results).toEqual([null, null])
      expect(catchFn).toHaveBeenCalledTimes(2)
    })
  })
})