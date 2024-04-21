import { createClerkClient, type ClerkOptions } from '@clerk/backend'
import type { ClerkClient } from '@clerk/backend'
import { AuthStatus, constants } from '@clerk/backend/internal'
import type { Context, MiddlewareHandler } from 'hono'
import { env } from 'hono/adapter'
import { createMiddleware } from 'hono/factory'

type ClerkAuth = Awaited<ReturnType<ClerkClient['authenticateRequest']>>['toAuth']

declare module 'hono' {
  interface ContextVariableMap {
    clerk: ClerkClient
    clerkAuth: ReturnType<ClerkAuth>
  }
}

export const getAuth = (c: Context) => {
  return c.get('clerkAuth')
}

type ClerkEnv = {
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  CLERK_API_URL: string
  CLERK_API_VERSION: string
}

export const clerkMiddleware = (options?: ClerkOptions): MiddlewareHandler => {
  return createMiddleware(async (c, next) => {
    const clerkEnv = env<ClerkEnv>(c)
    const { secretKey, publishableKey, apiUrl, apiVersion, ...rest } = options || {
      secretKey: clerkEnv.CLERK_SECRET_KEY || '',
      publishableKey: clerkEnv.CLERK_PUBLISHABLE_KEY || '',
      apiUrl: clerkEnv.CLERK_API_URL || 'https://api.clerk.dev',
      apiVersion: clerkEnv.CLERK_API_VERSION || 'v1',
    }

    console.log('hono clerk secret', secretKey, publishableKey)

    if (!secretKey) {
      throw new Error('Missing Clerk Secret key')
    }

    if (!publishableKey) {
      throw new Error('Missing Clerk Publishable key')
    }

    const clerkClient = createClerkClient({
      ...rest,
      apiUrl,
      apiVersion,
      secretKey,
      publishableKey,
    })

    const requestState = await clerkClient.authenticateRequest(c.req.raw, {
      ...rest,
      secretKey,
      publishableKey,
    })
    requestState.headers.forEach((value, key) => c.header(key, value))

    const locationHeader = c.req.header(constants.Headers.Location)

    if (locationHeader) {
      const authReason = requestState.reason || undefined
      c.header(constants.Headers.AuthStatus, requestState.status)
      c.header(constants.Headers.AuthReason, authReason)
      c.header(constants.Headers.AuthStatus, requestState.status)

      c.redirect(locationHeader, 307)
    } else if (requestState.status === AuthStatus.Handshake) {
      throw new Error('Clerk: handshake status without redirect')
    }

    c.set('clerkAuth', requestState.toAuth())
    c.set('clerk', clerkClient)

    await next()
  })
}
