import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from './lib/auth/session'

/**
 * Optimistic route guard: everything except the sign-in page, the cron
 * endpoint and static assets requires a valid signed session cookie. Pages
 * and actions re-check the session against the database.
 */
export async function proxy(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const url = new URL('/login', request.url)
  const next = request.nextUrl.pathname + request.nextUrl.search
  if (next !== '/') url.searchParams.set('next', next)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!login|api/cron|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
}
