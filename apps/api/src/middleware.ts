import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { env } from './config'

export interface OperatorClaims {
  sub: string
  roles: string[]
  mfa?: boolean
  iat: number
  exp?: number
}

export const OPERATOR_ADMIN_ROLE = 'operator_admin'
export const OPERATOR_VIEW_ROLE = 'operator_view'

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '8h', iss: 'hlprivateer-api', aud: 'hlprivateer-operator' }
  })

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch (error) {
      request.log.warn({ err: error }, 'authentication jwt verification failed')
      // Important: stop the request lifecycle here, otherwise the route handler will continue
      // and attempt to send a second response (Fastify will warn and Bun can crash).
      reply.code(401)
      return reply.send({ error: 'UNAUTHORIZED', message: 'missing or invalid token' })
    }
  })

  app.decorate('requireRole', function (roles: string[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.headers.authorization?.replace('Bearer ', '')
      if (!token) {
        void reply.code(401).send({ error: 'UNAUTHORIZED', message: 'missing token' })
        return
      }

      let payload: OperatorClaims
      try {
        payload = (await request.jwtVerify()) as OperatorClaims
      } catch (error) {
        request.log.warn({ err: error }, 'role check jwt verification failed')
        void reply.code(401).send({ error: 'UNAUTHORIZED', message: 'invalid token' })
        return
      }

      const claims = (request as { user?: OperatorClaims }).user
      const requestHasRole = roles.some((role) => claims?.roles?.includes(role))
      if (!requestHasRole) {
        void reply.code(403).send({ error: 'FORBIDDEN', message: `role required: ${roles.join(',')}` })
        return
      }

      if (roles.includes(OPERATOR_ADMIN_ROLE) && env.OPERATOR_MFA_REQUIRED && !claims?.mfa) {
        reply.code(403)
        return reply.send({ error: 'MFA_REQUIRED', message: 'MFA required for admin action' })
      }
    }
  })
}

export function hasRole(request: FastifyRequest, role: string): boolean {
    const token = request.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return false
  }

  try {
    const claims = (request as { user?: OperatorClaims }).user
    return (claims?.roles ?? []).includes(role)
  } catch (error) {
    request.log.warn({ err: error }, 'failed to read role from jwt payload')
    return false
  }
}
