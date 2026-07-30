/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { Loader2, LogIn, KeyRound, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { PasswordInput } from '@/components/password-input'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login, sendSMSVerification, wechatLoginByCode } from '@/features/auth/api'
import { LegalConsent } from '@/features/auth/components/legal-consent'
import { OAuthProviders } from '@/features/auth/components/oauth-providers'
import { loginFormSchema } from '@/features/auth/constants'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { useTurnstile } from '@/features/auth/hooks/use-turnstile'
import { beginPasskeyLogin, finishPasskeyLogin } from '@/features/auth/passkey'
import type { AuthFormProps, LoginMode } from '@/features/auth/types'
import { useCountdown } from '@/hooks/use-countdown'
import { useStatus } from '@/hooks/use-status'
import {
  buildAssertionResult,
  prepareCredentialRequestOptions,
  isPasskeySupported as detectPasskeySupport,
} from '@/lib/passkey'
import { cn } from '@/lib/utils'

const SMS_COUNTDOWN = 60

const smsLoginFormSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, 'Please enter a valid phone number'),
  code: z.string().min(4, 'Please enter the verification code'),
})

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: AuthFormProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [wechatCode, setWeChatCode] = useState('')
  const [agreedToLegal, setAgreedToLegal] = useState(false)
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)
  const [isWeChatDialogOpen, setIsWeChatDialogOpen] = useState(false)
  const [isWeChatSubmitting, setIsWeChatSubmitting] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('password')
  const [isSendingCode, setIsSendingCode] = useState(false)
  const {
    secondsLeft,
    isActive,
    start: startCountdown,
  } = useCountdown({ initialSeconds: SMS_COUNTDOWN })
  const legalConsentErrorMessage = t('Please agree to the legal terms first')
  const loginFailedMessage = t('Login failed')

  const { status } = useStatus()
  const passkeyLoginEnabled = Boolean(
    status?.passkey_login ?? status?.data?.passkey_login
  )
  const passwordLoginEnabled =
    (status?.password_login_enabled ??
      status?.data?.password_login_enabled ??
      true) !== false
  const smsLoginEnabled = Boolean(
    status?.sms_login ?? status?.data?.sms_login
  )
  const {
    isTurnstileEnabled,
    turnstileSiteKey,
    turnstileToken,
    setTurnstileToken,
    validateTurnstile,
  } = useTurnstile()
  const { handleLoginSuccess, redirectTo2FA } = useAuthRedirect()

  const hasUserAgreement = Boolean(status?.user_agreement_enabled)
  const hasPrivacyPolicy = Boolean(status?.privacy_policy_enabled)
  const requiresLegalConsent = hasUserAgreement || hasPrivacyPolicy
  const passkeyButtonDisabled =
    isPasskeyLoading ||
    !passkeySupported ||
    (requiresLegalConsent && !agreedToLegal)
  const hasWeChatLogin = Boolean(status?.wechat_login)
  const hasOAuthLogin = Boolean(
    status?.github_oauth ||
    status?.discord_oauth ||
    status?.oidc_enabled ||
    status?.linuxdo_oauth ||
    status?.telegram_oauth ||
    (status?.custom_oauth_providers?.length ?? 0) > 0
  )
  const hasAlternativeLogin =
    passkeyLoginEnabled || hasWeChatLogin || hasOAuthLogin

  // Auto-switch to SMS mode if password login is disabled and SMS is available
  useEffect(() => {
    if (!passwordLoginEnabled && smsLoginEnabled) {
      setLoginMode('sms')
    }
  }, [passwordLoginEnabled, smsLoginEnabled])

  useEffect(() => {
    if (requiresLegalConsent) {
      setAgreedToLegal(false)
    } else {
      setAgreedToLegal(true)
    }
  }, [requiresLegalConsent])

  useEffect(() => {
    detectPasskeySupport()
      .then(setPasskeySupported)
      .catch(() => setPasskeySupported(false))
  }, [])

  const passwordForm = useForm<z.infer<typeof loginFormSchema>>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  })

  const smsForm = useForm<z.infer<typeof smsLoginFormSchema>>({
    resolver: zodResolver(smsLoginFormSchema),
    defaultValues: {
      phone: '',
      code: '',
    },
  })

  const wechatQrCodeUrl = useMemo(() => {
    return (
      status?.wechat_qrcode ||
      status?.wechat_qr_code ||
      status?.wechat_qrcode_image_url ||
      status?.wechat_qr_code_image_url ||
      status?.wechat_account_qrcode_image_url ||
      status?.WeChatAccountQRCodeImageURL ||
      status?.data?.wechat_qrcode ||
      status?.data?.WeChatAccountQRCodeImageURL ||
      ''
    )
  }, [status])

  async function onPasswordSubmit(data: z.infer<typeof loginFormSchema>) {
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    if (!validateTurnstile()) return

    setIsLoading(true)
    try {
      const res = await login({
        username: data.username,
        password: data.password,
        turnstile: turnstileToken,
      })

      if (res.success) {
        if (res.data?.require_2fa) {
          redirectTo2FA()
          return
        }

        await handleLoginSuccess(res.data as { id?: number } | null, redirectTo)
        toast.success(t('Welcome back!'))
      }
    } catch (_error) {
      // Errors are handled by global interceptor
    } finally {
      setIsLoading(false)
    }
  }

  async function onSmsSubmit(data: z.infer<typeof smsLoginFormSchema>) {
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    if (!validateTurnstile()) return

    setIsLoading(true)
    try {
      const res = await login({
        phone: data.phone,
        code: data.code,
        turnstile: turnstileToken,
      })

      if (res.success) {
        if (res.data?.require_2fa) {
          redirectTo2FA()
          return
        }

        await handleLoginSuccess(res.data as { id?: number } | null, redirectTo)
        toast.success(t('Welcome back!'))
      }
    } catch (_error) {
      // Errors are handled by global interceptor
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSendSmsCode() {
    const phone = smsForm.getValues('phone')
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      toast.error(t('Please enter a valid phone number'))
      return
    }

    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    if (!validateTurnstile()) return

    setIsSendingCode(true)
    try {
      const res = await sendSMSVerification(phone, 'login', turnstileToken)
      if (res?.success) {
        startCountdown()
        toast.success(t('Verification code sent'))
      } else {
        toast.error(res?.message || t('Failed to send verification code'))
      }
    } catch (_error) {
      // Errors handled by global interceptor
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleOpenWeChatDialog = () => {
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    setIsWeChatDialogOpen(true)
  }

  const handleWeChatDialogChange = (open: boolean) => {
    setIsWeChatDialogOpen(open)
    if (!open) {
      setWeChatCode('')
      setIsWeChatSubmitting(false)
    }
  }

  async function handleWeChatLogin() {
    if (!wechatCode.trim()) {
      toast.error(t('Please enter the verification code'))
      return
    }

    setIsWeChatSubmitting(true)
    try {
      const res = await wechatLoginByCode(wechatCode)
      if (res?.success) {
        await handleLoginSuccess(res.data as { id?: number } | null, redirectTo)
        toast.success(t('Signed in via WeChat'))
        handleWeChatDialogChange(false)
      } else {
        toast.error(res?.message || loginFailedMessage)
      }
    } catch (_error) {
      toast.error(loginFailedMessage)
    } finally {
      setIsWeChatSubmitting(false)
    }
  }

  async function handlePasskeyLogin() {
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    if (!passkeySupported) {
      toast.error(t('Passkey is not supported on this device'))
      return
    }

    if (!navigator?.credentials) {
      toast.error(t('Passkey is not available in this browser'))
      return
    }

    setIsPasskeyLoading(true)
    try {
      const begin = await beginPasskeyLogin()
      if (!begin.success) {
        throw new Error(begin.message || t('Failed to start Passkey login'))
      }

      const publicKey = prepareCredentialRequestOptions(
        begin.data?.options ?? begin.data
      )

      const credential = (await navigator.credentials.get({
        publicKey,
      })) as PublicKeyCredential | null

      if (!credential) {
        toast.info(t('Passkey login was cancelled'))
        return
      }

      const assertion = buildAssertionResult(credential)
      if (!assertion) {
        throw new Error(t('Invalid Passkey response'))
      }

      const finish = await finishPasskeyLogin(assertion)
      if (!finish.success) {
        throw new Error(finish.message || t('Failed to complete Passkey login'))
      }

      if (!finish.data) {
        throw new Error(t('Missing user data from Passkey login response'))
      }

      await handleLoginSuccess(
        finish.data as { id?: number } | null,
        redirectTo
      )
      toast.success(t('Signed in with Passkey'))
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        toast.info(t('Passkey login was cancelled or timed out'))
      } else if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error(t('Passkey login failed'))
      }
    } finally {
      setIsPasskeyLoading(false)
    }
  }

  const alternativeLoginMethods = (
    <>
      {passkeyLoginEnabled && (
        <div className='mt-2 space-y-1'>
          <Button
            type='button'
            variant='outline'
            disabled={passkeyButtonDisabled}
            onClick={handlePasskeyLogin}
            className='h-11 w-full justify-center gap-2 rounded-lg'
          >
            {isPasskeyLoading ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <KeyRound className='h-4 w-4' />
            )}
            {t('Sign in with Passkey')}
          </Button>
          {!passkeySupported && (
            <p className='text-muted-foreground text-xs'>
              {t('Passkey is not supported on this device.')}
            </p>
          )}
        </div>
      )}

      {/* OAuth Providers */}
      <OAuthProviders
        status={status}
        disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}
        onWeChatLogin={hasWeChatLogin ? handleOpenWeChatDialog : undefined}
        isWeChatLoading={isWeChatSubmitting}
      />
    </>
  )

  const modeTabs = smsLoginEnabled && passwordLoginEnabled ? (
    <div className='flex rounded-lg border p-0.5'>
      <button
        type='button'
        onClick={() => setLoginMode('password')}
        className={cn(
          'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          loginMode === 'password'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <LogIn className='h-4 w-4' />
        {t('Password')}
      </button>
      <button
        type='button'
        onClick={() => setLoginMode('sms')}
        className={cn(
          'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          loginMode === 'sms'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Smartphone className='h-4 w-4' />
        {t('SMS Code')}
      </button>
    </div>
  ) : null

  // Password login form
  const passwordFormBlock = passwordLoginEnabled && loginMode === 'password' && (
    <Form {...passwordForm}>
      <form
        onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
        className={cn('grid gap-4', className)}
        {...props}
      >
        {modeTabs}
        {hasAlternativeLogin && alternativeLoginMethods}

        {/* Username Field */}
        <FormField
          control={passwordForm.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Username or Email')}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t('Enter your username or email')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Password Field */}
        <FormField
          control={passwordForm.control}
          name='password'
          render={({ field }) => (
            <FormItem className='relative'>
              <FormLabel>{t('Password')}</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder={t('Enter password')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
              <Link
                to='/forgot-password'
                className='text-muted-foreground absolute end-0 -top-0.5 z-10 text-sm font-medium hover:opacity-75'
              >
                {t('Forgot password?')}
              </Link>
            </FormItem>
          )}
        />

        {/* Submit Button */}
        <Button
          type='submit'
          className='mt-2 w-full justify-center gap-2'
          disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}
        >
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          {t('Sign in')}
        </Button>

        {/* Turnstile */}
        {isTurnstileEnabled && (
          <div className='mt-2'>
            <Turnstile
              siteKey={turnstileSiteKey}
              onVerify={setTurnstileToken}
            />
          </div>
        )}

        <LegalConsent
          status={status}
          checked={agreedToLegal}
          onCheckedChange={setAgreedToLegal}
          className='mt-1'
        />

        {!hasAlternativeLogin && alternativeLoginMethods}
      </form>
    </Form>
  )

  // SMS login form
  const smsFormBlock = smsLoginEnabled && loginMode === 'sms' && (
    <Form {...smsForm}>
      <form
        onSubmit={smsForm.handleSubmit(onSmsSubmit)}
        className={cn('grid gap-4', className)}
        {...props}
      >
        {modeTabs}
        {hasAlternativeLogin && alternativeLoginMethods}

        {/* Phone Field */}
        <FormField
          control={smsForm.control}
          name='phone'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Phone number')}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t('Enter your phone number')}
                  type='tel'
                  maxLength={11}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Verification Code Field */}
        <FormField
          control={smsForm.control}
          name='code'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Verification code')}</FormLabel>
              <div className='flex items-end gap-2'>
                <div className='flex-1'>
                  <FormControl>
                    <Input
                      placeholder={t('Enter verification code')}
                      maxLength={6}
                      {...field}
                    />
                  </FormControl>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  disabled={
                    isLoading ||
                    isSendingCode ||
                    isActive ||
                    !smsForm.getValues('phone') ||
                    !turnstileToken
                  }
                  onClick={handleSendSmsCode}
                  className='shrink-0'
                >
                  {isActive
                    ? t('Resend ({{seconds}}s)', { seconds: secondsLeft })
                    : isSendingCode
                      ? <Loader2 className='h-4 w-4 animate-spin' />
                      : t('Send code')}
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Submit Button */}
        <Button
          type='submit'
          className='mt-2 w-full justify-center gap-2'
          disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}
        >
          {isLoading ? <Loader2 className='animate-spin' /> : <Smartphone />}
          {t('Sign in with SMS')}
        </Button>

        {/* Turnstile */}
        {isTurnstileEnabled && (
          <div className='mt-2'>
            <Turnstile
              siteKey={turnstileSiteKey}
              onVerify={setTurnstileToken}
            />
          </div>
        )}

        <LegalConsent
          status={status}
          checked={agreedToLegal}
          onCheckedChange={setAgreedToLegal}
          className='mt-1'
        />

        {!hasAlternativeLogin && alternativeLoginMethods}
      </form>
    </Form>
  )

  return (
    <>
      {passwordFormBlock}
      {smsFormBlock}

      {hasWeChatLogin && (
        <Dialog
          open={isWeChatDialogOpen}
          onOpenChange={handleWeChatDialogChange}
          title={t('WeChat sign in')}
          description={t(
            'Scan the QR code to follow the official account and reply with "验证码" to receive your verification code.'
          )}
          contentClassName='max-w-sm'
          headerClassName='text-left'
          contentHeight='auto'
          bodyClassName='space-y-4'
          footer={
            <>
              <Button
                type='button'
                variant='outline'
                onClick={() => handleWeChatDialogChange(false)}
                disabled={isWeChatSubmitting}
              >
                {t('Cancel')}
              </Button>
              <Button
                type='button'
                onClick={handleWeChatLogin}
                disabled={
                  isWeChatSubmitting ||
                  !wechatCode.trim() ||
                  (requiresLegalConsent && !agreedToLegal)
                }
                className='gap-2'
              >
                {isWeChatSubmitting ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                {t('Confirm')}
              </Button>
            </>
          }
        >
          {wechatQrCodeUrl ? (
            <div className='flex justify-center'>
              <img
                src={wechatQrCodeUrl}
                alt={t('WeChat login QR code')}
                className='h-40 w-40 rounded-md border object-contain'
              />
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('QR code is not configured. Please contact support.')}
            </p>
          )}
          <div className='grid gap-2'>
            <Label htmlFor='wechat-code'>{t('Verification code')}</Label>
            <Input
              id='wechat-code'
              placeholder={t('Enter the verification code')}
              value={wechatCode}
              onChange={(event) => setWeChatCode(event.target.value)}
              autoComplete='one-time-code'
            />
          </div>
        </Dialog>
      )}
    </>  // Close fragment
  )
}
