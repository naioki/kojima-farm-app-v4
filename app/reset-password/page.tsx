'use client'

/**
 * パスワードリセットのリンクを踏んだ後に、新しいパスワードを設定する画面。
 *
 * 以前は resetPasswordForEmail の redirectTo が /login を指していたが、
 * /login には「新しいパスワードを入力する」フォームが無く、リンクを踏んでも
 * 普通のログイン画面が出るだけでリセットが完成しなかった。このページを新設し、
 * login/page.tsx の redirectTo をこちらに向けている。
 *
 * リンクのトークンは URL のハッシュ（#access_token=...&type=recovery）に
 * 乗っているため、サーバー（proxy.ts のミドルウェア）からは見えない。
 * ブラウザの Supabase クライアントが detectSessionInUrl で読み取って
 * セッションを張るまで一瞬かかるので、その完了を待ってからフォームを出す。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const MIN_PASSWORD_LENGTH = 8
/** リンクのトークン読み取りをこの時間待っても駄目ならリンク切れ扱いにする */
const SESSION_WAIT_MS = 5_000

type SessionState = 'checking' | 'ready' | 'invalid'

export default function ResetPasswordPage() {
  const [sessionState, setSessionState] = useState<SessionState>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessionState('ready')
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setSessionState('ready')
      }
    })

    const timeout = setTimeout(() => {
      // ready になっていれば何もしない。まだ checking のままならリンク切れ。
      setSessionState((current) => (current === 'checking' ? 'invalid' : current))
    }, SESSION_WAIT_MS)

    return () => {
      listener.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。`)
      return
    }
    if (password !== confirm) {
      setError('確認用のパスワードが一致しません。')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setError('パスワードの更新に失敗しました。もう一度リセットをやり直してください。')
      } else {
        setDone(true)
      }
    } catch {
      setError('通信エラーが発生しました。時間をおいて再度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <CardTitle className="text-xl">新しいパスワードの設定</CardTitle>
          {sessionState === 'ready' && !done && (
            <CardDescription>新しいパスワードを入力してください</CardDescription>
          )}
        </CardHeader>

        <CardContent>
          {sessionState === 'checking' && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              確認しています...
            </div>
          )}

          {sessionState === 'invalid' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>
                  リンクが無効か、期限切れです。ログイン画面から
                  もう一度リセットをお試しください。
                </AlertDescription>
              </Alert>
              <Button asChild className="w-full">
                <Link href="/login">ログイン画面に戻る</Link>
              </Button>
            </div>
          )}

          {sessionState === 'ready' && done && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>パスワードを更新しました。</AlertDescription>
              </Alert>
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  // クッキーを確実に反映させるためフルリロードで遷移する
                  window.location.href = '/dashboard/verifications'
                }}
              >
                続ける
              </Button>
            </div>
          )}

          {sessionState === 'ready' && !done && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">新しいパスワード</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={
                      showPassword ? 'パスワードを隠す' : 'パスワードを表示する'
                    }
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">新しいパスワード（確認）</Label>
                <Input
                  id="confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? '更新中...' : 'パスワードを更新'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
