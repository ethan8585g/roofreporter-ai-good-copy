// ============================================================
// Roof Manager — Request Validation Schemas (Zod)
// Replaces manual type casting with runtime validation.
// ============================================================

import { z } from 'zod'

/** Common: orderId path parameter (string that parses to positive int) */
export const orderIdParam = z.object({
  orderId: z.string().regex(/^\d+$/, 'orderId must be a numeric string')
})

/** POST /:orderId/toggle-segments */
export const toggleSegmentsBody = z.object({
  excluded_segments: z.array(z.number().int().min(0)).default([])
})

/** POST /:orderId/vision-inspect */
export const visionInspectBody = z.object({
  force: z.boolean().optional().default(false)
}).optional().default({ force: false })

/** GET /:orderId/vision — query filters */
export const visionFilterQuery = z.object({
  min_confidence: z.coerce.number().min(0).max(100).optional(),
  category: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional()
})

/** POST /datalayers/analyze */
export const datalayersAnalyzeBody = z.object({
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional()
}).refine(d => d.address || (d.lat && d.lng), {
  message: 'Provide "address" or "lat"+"lng"'
})

/** POST /:orderId/email */
export const emailBody = z.object({
  to_email: z.string().email().optional(),
  subject_override: z.string().max(200).optional(),
  from_email: z.string().email().optional()
}).optional().default({})

/** Helper: validate and return parsed body, or throw with 400-friendly message */
export function parseBody<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const msg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new ValidationError(msg)
  }
  return result.data
}

/** Custom error class for validation failures */
export class ValidationError extends Error {
  status = 400 as const
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
