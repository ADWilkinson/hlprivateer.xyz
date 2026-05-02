import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { hasRole, OPERATOR_ADMIN_ROLE, OPERATOR_VIEW_ROLE, registerAuth } from './middleware'

describe('auth middleware', () => {
  it('requireRole uses the verified JWT payload for role checks', async () => {
    const app = Fastify()
    await registerAuth(app)

    app.get(
      '/admin',
      {
        preHandler: [(app as any).requireRole([OPERATOR_ADMIN_ROLE])]
      },
      async () => ({ ok: true })
    )

    const adminToken = await (app as any).jwt.sign({ sub: 'alice', roles: [OPERATOR_ADMIN_ROLE], mfa: true })
    const resOk = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(resOk.statusCode).toBe(200)

    const viewToken = await (app as any).jwt.sign({ sub: 'bob', roles: [OPERATOR_VIEW_ROLE], mfa: true })
    const resForbidden = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: `Bearer ${viewToken}` }
    })
    expect(resForbidden.statusCode).toBe(403)

    const resUnauthorized = await app.inject({ method: 'GET', url: '/admin' })
    expect(resUnauthorized.statusCode).toBe(401)

    await app.close()
  })

  it('requireRole enforces MFA when admin role is required', async () => {
    const app = Fastify()
    await registerAuth(app)

    app.get(
      '/admin',
      {
        preHandler: [(app as any).requireRole([OPERATOR_ADMIN_ROLE])]
      },
      async () => ({ ok: true })
    )

    const tokenNoMfa = await (app as any).jwt.sign({ sub: 'alice', roles: [OPERATOR_ADMIN_ROLE], mfa: false })
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: `Bearer ${tokenNoMfa}` }
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'MFA_REQUIRED' })

    await app.close()
  })

  it('hasRole verifies the token when request.user is not populated', async () => {
    const app = Fastify()
    await registerAuth(app)

    app.get('/check', async (request) => {
      return {
        isAdmin: await hasRole(request, OPERATOR_ADMIN_ROLE)
      }
    })

    const token = await (app as any).jwt.sign({ sub: 'alice', roles: [OPERATOR_ADMIN_ROLE], mfa: true })
    const res = await app.inject({
      method: 'GET',
      url: '/check',
      headers: { authorization: `Bearer ${token}` }
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ isAdmin: true })

    await app.close()
  })
})
