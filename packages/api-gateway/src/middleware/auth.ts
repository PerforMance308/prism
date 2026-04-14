import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { ApiError } from '@agentic-obs/common'
import { createLogger } from '@agentic-obs/common'
import { getJwtSecret } from '../auth/jwt-secret.js'
import { roleStore } from './rbac.js'

const log = createLogger('auth')

export interface AuthenticatedRequest extends Request {
  auth?: {
    sub: string
    type: 'jwt' | 'apikey'
    roles?: string[]
    permissions?: string[]
  }
}

const JWT_SECRET = getJwtSecret('auth')

const VALID_API_KEYS = new Set(
  (process.env['API_KEYS'] ?? '').split(',').map((k) => k.trim()).filter(Boolean),
)
const DEV_AUTH_BYPASS_ENABLED =
  process.env['NODE_ENV'] !== 'production' && process.env['DEV_AUTH_BYPASS'] === 'true'

if (DEV_AUTH_BYPASS_ENABLED) {
  log.warn('DEV_AUTH_BYPASS=true; unauthenticated requests will be allowed in this process')
}

function resolveRoleInfo(
  req: AuthenticatedRequest,
  jwtPayload?: jwt.JwtPayload,
): { roles: string[], permissions: string[] } {
  let roles: string[]
  if (jwtPayload) {
    // JWT: read `roles` (array) or `role` (string) from token payload;
    // fall back to `viewer` so JWTs without explicit roles get read-only access.
    const payloadRoles = jwtPayload['roles']
    const payloadRole = jwtPayload['role']
    if (Array.isArray(payloadRoles) && payloadRoles.length > 0) {
      roles = payloadRoles.map(String)
    }
    else if (typeof payloadRole === 'string' && payloadRole.length > 0) {
      roles = [payloadRole]
    }
    else {
      // Allow x-user-role header as a dev-time override (non-production + DEV_ROLE_OVERRIDE=true only)
      const roleOverrideEnabled = process.env['NODE_ENV'] !== 'production' && process.env['DEV_ROLE_OVERRIDE'] === 'true'
      const headerRole = roleOverrideEnabled ? req.headers['x-user-role'] : undefined
      roles = [typeof headerRole === 'string' && headerRole.length > 0 ? headerRole : 'viewer']
    }
  }
  else {
    // API key: default to `operator` (service-to-service calls)
    // x-user-role override only permitted outside production with DEV_ROLE_OVERRIDE=true
    const roleOverrideEnabled = process.env['NODE_ENV'] !== 'production' && process.env['DEV_ROLE_OVERRIDE'] === 'true'
    const headerRole = roleOverrideEnabled ? req.headers['x-user-role'] : undefined
    roles = [typeof headerRole === 'string' && headerRole.length > 0 ? headerRole : 'operator']
  }

  const permissions = roleStore.resolvePermissions(roles)
  return { roles, permissions }
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers['authorization']
  const apiKeyHeader = process.env['API_KEY_HEADER'] ?? 'x-api-key'
  const apiKey = req.headers[apiKeyHeader]

  // API Key auth
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    if (VALID_API_KEYS.has(apiKey)) {
      const { roles, permissions } = resolveRoleInfo(req)
      req.auth = { sub: apiKey, type: 'apikey', roles, permissions }
      next()
      return
    }

    const error: ApiError = { code: 'INVALID_API_KEY', message: 'Invalid API key' }
    res.status(401).json(error)
    return
  }

  // JWT auth
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload
      const { roles, permissions } = resolveRoleInfo(req, payload)
      req.auth = { sub: payload['sub'] ?? '', type: 'jwt', roles, permissions }
      next()
      return
    }
    catch {
      const error: ApiError = { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
      res.status(401).json(error)
      return
    }
  }

  // Development bypass must be explicitly enabled to avoid accidentally exposing routes.
  if (DEV_AUTH_BYPASS_ENABLED) {
    const { roles, permissions } = resolveRoleInfo(req)
    req.auth = { sub: 'anonymous-dev', type: 'apikey', roles, permissions }
    next()
    return
  }

  const error: ApiError = { code: 'UNAUTHORIZED', message: 'Authentication required' }
  res.status(401).json(error)
}
