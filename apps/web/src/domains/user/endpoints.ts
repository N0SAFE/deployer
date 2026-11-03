import { orpc } from '@/lib/orpc'

/**
 * User domain endpoints
 * 
 * All user endpoints use ORPC contracts directly (no custom contracts needed).
 * ORPC provides full CRUD operations with type safety.
 */
export const userEndpoints = {
  /**
   * List users with pagination/filtering/sorting
   */
  list: orpc.user.list,
  
  /**
   * Delete the CALLER's own account (`AUTH-032`). Needs a fresh passkey step-up; the last super admin is refused.
   */
  deleteSelf: orpc.user.deleteSelf,

  /**
   * Export the CALLER's own data (`AUTH-032`). No id: the server scopes it to the session.
   */
  exportSelf: orpc.user.exportSelf,

  /**
   * Find a single user by ID
   */
  findById: orpc.user.findById,
  
  /**
   * Create a new user
   */
  create: orpc.user.create,
  
  /**
   * Update an existing user
   */
  update: orpc.user.update,
  
  /**
   * Delete a user
   */
  delete: orpc.user.delete,
  
  /**
   * Check if email is available
   */
  checkEmail: orpc.user.checkEmail,
  
  /**
   * Get user count statistics
   */
  count: orpc.user.count,
  
} as const

export type UserEndpoints = typeof userEndpoints