import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // 未ログインでダッシュボードにアクセス → ログインページへ
  if (!user && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // ログイン済みでログインページにアクセス → ダッシュボードへ
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard/verifications', request.url))
  }

  return supabaseResponse
}

export const config = {
  // api/chat を除外している理由:
  // 外部サービス（Discord / LINE Works / Google Chat）からの Webhook で、
  // Supabase のセッションクッキーを持たない。ここを通すと毎回
  // supabase.auth.getUser() の往復が入るだけ無駄で、特に Discord は
  // 3秒以内の応答を要求するため遅延が問題になる。
  matcher: [
    '/((?!api/chat|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
