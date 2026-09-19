import { NextResponse, type NextRequest } from "next/server"

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "@/lib/i18n-locale"
import { SHARE_PAGE_CSP } from "@/lib/presentations/code-scene"
import { SITE_URL, siteHosts } from "@/lib/site/config"

// Set by the togo auth plugin on login/register (HttpOnly).
const SESSION_COOKIE = "togo_session"

// Locale-stripped prefixes that need a session. The API is the security boundary; this file only
// decides where to SEND someone. A missing cookie goes straight to login; a present-but-invalid
// cookie is caught client-side when /api/auth/me answers 401.
const PROTECTED_PREFIXES = ["/brains", "/b", "/account", "/admin", "/oauth", "/connect"]

// Customer-facing share links (/p/{token}, its downloads and embeds) are public: the token is
// the only authorization, checked by the API. Never send a visitor there to a login page.
const PUBLIC_PREFIXES = ["/p"]

function isProtected(rest: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => rest === p || rest.startsWith(p + "/"))) return false
  return PROTECTED_PREFIXES.some((p) => rest === p || rest.startsWith(p + "/"))
}

function splitLocale(pathname: string): { locale: Locale | null; rest: string } {
  const [, maybe, ...tail] = pathname.split("/")
  if (isLocale(maybe)) return { locale: maybe, rest: "/" + tail.join("/") }
  return { locale: null, rest: pathname }
}

function shouldSkip(pathname: string): boolean {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/graphql") ||
    pathname.startsWith("/events") ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  )
}

function preferredLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value
  if (isLocale(cookie)) return cookie
  return localeFromAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE
}

/*
zekra.dev: the public landing + docs, served by this same app. A request is for the site when
its host is a site host (zekra.dev, www.zekra.dev, plus ZEKRA_SITE_HOSTS), or — for local work —
when it carries ?site=1, which sets a cookie so the rest of the visit stays on the site (?site=0
clears it). The console host (app.zekra.dev) never matches, so nothing changes there.

Public URLs are the same as fadymondy.com-v2 served them: /{locale}, /{locale}/docs,
/{locale}/docs/{slug…}, /sitemap.xml, /robots.txt, /llms.txt, /feed.xml and the IndexNow key
file. They are rewritten onto the internal /zsite tree, which is never reachable directly.
*/
const SITE_COOKIE = "zekra_site"
const SITE_FILES: Record<string, string> = {
  "/sitemap.xml": "/zsite/sitemap.xml",
  "/robots.txt": "/zsite/robots.txt",
  "/llms.txt": "/zsite/llms.txt",
  "/feed.xml": "/zsite/feed.xml",
  "/indexnow.txt": "/zsite/indexnow",
}

function requestHost(request: NextRequest): string {
  const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  return raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "")
}

function isSiteRequest(request: NextRequest): boolean {
  const host = requestHost(request)
  if (siteHosts().includes(host)) return true
  // The ?site=1 override is for local development only, never on a real host.
  if (host !== "localhost" && host !== "127.0.0.1") return false
  const flag = request.nextUrl.searchParams.get("site")
  if (flag === "1") return true
  if (flag === "0") return false
  return request.cookies.get(SITE_COOKIE)?.value === "1"
}

function siteProxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl
  const host = requestHost(request)

  // One canonical host: www.zekra.dev → zekra.dev.
  if (host.startsWith("www.") && siteHosts().includes(host)) {
    return NextResponse.redirect(new URL(pathname + request.nextUrl.search, SITE_URL), 308)
  }

  const withFlag = (response: NextResponse) => {
    const flag = request.nextUrl.searchParams.get("site")
    if (flag === "1") response.cookies.set(SITE_COOKIE, "1", { path: "/", sameSite: "lax" })
    if (flag === "0") response.cookies.delete(SITE_COOKIE)
    return response
  }
  const rewrite = (to: string, locale?: Locale) => {
    const url = request.nextUrl.clone()
    url.pathname = to
    const headers = new Headers(request.headers)
    if (locale) headers.set("x-locale", locale)
    headers.set("x-zekra-site", "1")
    return withFlag(NextResponse.rewrite(url, { request: { headers } }))
  }

  const file = SITE_FILES[pathname]
  if (file) return rewrite(file)
  const key = process.env.INDEXNOW_KEY
  if (key && pathname === `/${key}.txt`) return rewrite("/zsite/indexnow")

  // Static files, Next internals and the proxied API behave as on the console host.
  if (shouldSkip(pathname)) return NextResponse.next()

  const { locale, rest } = splitLocale(pathname)
  if (!locale) {
    const url = request.nextUrl.clone()
    url.pathname = `/${preferredLocale(request)}${pathname === "/" ? "" : pathname}`
    url.searchParams.delete("site")
    return withFlag(NextResponse.redirect(url))
  }

  const response = rewrite(`/zsite/${locale}${rest === "/" ? "" : rest.replace(/\/$/, "")}`, locale)
  if (request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" })
  }
  return response
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  // The internal site tree is only reachable through the rewrite above.
  if (pathname === "/zsite" || pathname.startsWith("/zsite/")) return new NextResponse("Not found", { status: 404 })
  if (isSiteRequest(request)) return siteProxy(request)
  if (shouldSkip(pathname)) return NextResponse.next()

  const { locale, rest } = splitLocale(pathname)
  const signedIn = request.cookies.has(SESSION_COOKIE)

  // No locale in the URL: remembered language, then Accept-Language, then English.
  if (!locale) {
    const url = request.nextUrl.clone()
    const target = preferredLocale(request)
    url.pathname = pathname === "/" ? `/${target}/${signedIn ? "brains" : "login"}` : `/${target}${pathname}`
    return NextResponse.redirect(url)
  }

  const restPath = rest === "" ? "/" : rest.replace(/\/$/, "") || "/"

  if (restPath === "/") {
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/${signedIn ? "brains" : "login"}`
    return NextResponse.redirect(url)
  }

  if (isProtected(restPath) && !signedIn) {
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/login`
    url.search = ""
    url.searchParams.set("next", pathname + search)
    return NextResponse.redirect(url)
  }

  // The root layout cannot read route params, so it reads the locale from here.
  const headers = new Headers(request.headers)
  headers.set("x-locale", locale)
  const response = NextResponse.next({ request: { headers } })
  // A shared presentation may hold sandboxed srcdoc "code" scenes: same-origin frames only,
  // never framed by another site.
  if (restPath.startsWith("/p/")) {
    response.headers.set("Content-Security-Policy", SHARE_PAGE_CSP)
  }
  if (request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" })
  }
  return response
}

export const config = {
  matcher: "/:path*",
}
