'use client'

/**
 * ログイン画面。
 *
 * 以前は shadcn のコンポーネントもデザイントークンも使わず、生の HTML に
 * bg-gray-50 / bg-white / bg-green-600 / focus:ring-green-500 を直接書いていた。
 * ユーザーが最初に見る画面がアプリ本体と別物の見た目になっていたため、
 * 他画面と同じ部品・同じトークンで組み直している。
 */

import { useState } from 'react'
import { Eye, EyeOff, Loader2, Sprout } from 'lucide-react'

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

const LOGIN_TIMEOUT_MS = 15_000
const RESET_TIMEOUT_MS = 10_000

/** 一定時間で必ず決着させる（ネットワークが不通のとき無限に待たせないため）。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ])
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        LOGIN_TIMEOUT_MS
      )
      if (error) {
        setError('メールアドレスまたはパスワードが正しくありません。')
      } else {
        // クッキーを確実に反映させるためフルリロードで遷移する
        window.location.href = '/dashboard/verifications'
      }
    } catch {
      setError('タイムアウトしました。時間をおいて再度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        }),
        RESET_TIMEOUT_MS
      )
      if (error) {
        setError(
          'リセットメールの送信に失敗しました。メールアドレスを確認してください。'
        )
      } else {
        setResetSent(true)
      }
    } catch {
      setError('タイムアウトまたはエラーが発生しました。再度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  function backToLogin() {
    setResetMode(false)
    setResetSent(false)
    setError('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <Sprout className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <CardTitle className="text-xl">小島農園 管理システム</CardTitle>
          <CardDescription>
            {resetMode ? 'パスワードのリセット' : 'ログイン'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {resetMode && resetSent ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  リセット用のメールを送信しました。メールボックスをご確認ください。
                </AlertDescription>
              </Alert>
              <Button variant="outline" className="w-full" onClick={backToLogin}>
                ログイン画面に戻る
              </Button>
            </div>
          ) : resetMode ? (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">登録済みのメールアドレス</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="info@example.com"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? '送信中...' : 'リセットメールを送信'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={backToLogin}
              >
                ログイン画面に戻る
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="info@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
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

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? 'ログイン中...' : 'ログイン'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => {
                  setResetMode(true)
                  setError('')
                }}
              >
                パスワードを忘れた方はこちら
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
