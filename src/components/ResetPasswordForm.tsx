import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '@/components/ui'
import { authApi } from '@/features/auth'
import { validateEmail } from '@/lib/email'
import { resetPasswordSchema, type ResetPasswordFormValues } from '@/features/auth'
import { useFormSubmission } from '@/hooks/useFormSubmission'

/**
 * Reset-password form: request a reset link by email and then choose a new
 * password once a valid token is present. The email step is the same
 * request-for-link form from #932; the new-password step adds mismatch and
 * password-strength validation (#140) with accessible, focusable feedback.
 */
export interface ResetPasswordFormProps {
  /** The reset token from the URL (``?token=...``). Empty until the page picks
   * it up from the query string / route param. */
  token?: string
  /** Called when the form is submitted for the first time, so the app can
   * navigate or render the token-sharing step. */
  onRequestReset?: (email: string) => Promise<void>
  /** Called after a successful password reset, so the app can redirect or
   * surface a confirmation. */
  onReset?: () => void
  /** Optional label override for the email step submit button. */
  requestLabel?: string
  /** Optional label override for the password step submit button. */
  resetLabel?: string
}

type ResetPasswordFormState =
  | { step: 'request' }
  | { step: 'reset'; token: string }

function flattenError(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string') {
      out[field] = issue.message
    }
  }
  return out
}

/**
 * Returns the first field name that has an error so the form can move focus
 * there after a submission round-trip (#140).
 */
export function firstInvalidField(
  errors: Record<string, string>,
): keyof Pick<ResetPasswordFormValues, 'password' | 'confirmPassword'> | null {
  if (errors.password) return 'password'
  if (errors.confirmPassword) return 'confirmPassword'
  return null
}

/**
 * Password-reset flow: first request a reset link, then choose a new password
 * once the link’s token is available.
 */
export default function ResetPasswordForm({
  token: tokenProp,
  onRequestReset,
  onReset,
  requestLabel = 'Send reset link',
  resetLabel = 'Reset password',
}: ResetPasswordFormProps = {}) {
  const [state, setState] = useState<ResetPasswordFormState>(
    tokenProp ? { step: 'reset', token: tokenProp } : { step: 'request' },
  )
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  /** Live mismatch hint shown under the confirm field while both fields are
   * filled but don’t match. It clears as soon as the user fixes either field,
   * so it never blocks a valid submission. */
  const [mismatchHint, setMismatchHint] = useState<string | null>(null)

  const requestSubmit = useFormSubmission(
    async () => {
      if (!onRequestReset) return
      await onRequestReset(email.trim())
    },
  )

  const resetSubmit = useFormSubmission(
    async () => {
      const parsed = resetPasswordSchema.parse({ password, confirmPassword })
      await authApi.resetPassword({ token: state.token, password: parsed.password })
      onReset?.()
    },
    { cooldownMs: 0 },
  )

  const runResetSubmit = useCallback(async () => {
    await resetSubmit.runSubmit()
  }, [resetSubmit.runSubmit])

  /** When the token prop changes (e.g. the URL query string updates), keep the
   * form in sync without requiring a re-render from the parent. */
  useEffect(() => {
    if (tokenProp) {
      setState({ step: 'reset', token: tokenProp })
      setPasswordError(null)
      setConfirmError(null)
      setMismatchHint(null)
    }
  }, [tokenProp])

  /** Visible focusable error container used for both client-side and
   * server-returned validation feedback. An empty string would be invalid
   * DOM, so we gate on presence. */
  const errorAnnouncerId = 'reset-password-form-error'

  /** After a submission succeeds or the user fixes a field, move focus back to
   * the first invalid control so keyboard users land on the problem. */
  const focusField = useCallback(
    (field: keyof Pick<typeof resetPasswordSchema._output, 'password' | 'confirmPassword'>) => {
      const el =
        field === 'password'
          ? document.getElementById('reset-password-password')
          : document.getElementById('reset-password-confirm')
      el?.focus()
    },
    [],
  )

  /** Client-side validation for the password step. Runs on every keystroke so
   * the mismatch hint and per-field errors stay current, and after submit so
   * an invalid form is not sent to the server. */
  const validateResetFields = useCallback(
    ():
      | { valid: true; parsed?: z.output<typeof resetPasswordSchema> }
      | { valid: false; errors: Record<string, string> } => {
      const result = resetPasswordSchema.safeParse({
        password,
        confirmPassword,
      })
      if (result.success) {
        // Clear mismatch hint once the passwords agree.
        if (mismatchHint) setMismatchHint(null)
        return { valid: true, parsed: result.data }
      }

      const errors = flattenError(result.error)

      // Derive the live mismatch hint separately so the confirm field can show
      // “passwords do not match” without taking the invalid state until submit.
      const passwordFilled = password.trim().length > 0
      const confirmFilled = confirmPassword.trim().length > 0
      if (passwordFilled && confirmFilled && password !== confirmPassword) {
        setMismatchHint('Passwords do not match.')
      } else {
        setMismatchHint(null)
      }

      return { valid: false, errors }
    },
    [password, confirmPassword, mismatchHint],
  )

  /** Returns a visible error text for the requested field (priority: server/
   * submit-time error, then client-side error, then live mismatch hint). */
  const fieldError = useCallback(
    (field: 'password' | 'confirmPassword') => {
      if (field === 'password') return passwordError ?? undefined
      if (field === 'confirmPassword') return confirmError ?? undefined
      return undefined
    },
    [passwordError, confirmError],
  )

  const handleRequestSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const error = validateEmail(email)
    if (error) {
      setEmailError(error)
      return
    }
    setEmailError(null)
    void requestSubmit()
  }

  const handleResetSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validation = validateResetFields()
    if (!validation.valid) {
      setPasswordError(validation.errors.password ?? null)
      setConfirmError(validation.errors.confirmPassword ?? null)
      const field = firstInvalidField(validation.errors)
      if (field) focusField(field)
      return
    }
    setPasswordError(null)
    setConfirmError(null)
    void runResetSubmit()
  }

  /** React to a server-returned validation error (e.g. 422 with field errors)
   * so the form can announce and focus it the same way as client-side errors
   * (#145 / #140). */
  const handleResetError = useCallback(
    (err: unknown) => {
      // `useFormSubmission` re-throws, so this callback is only reached when the
      // caller catches. Keep the behaviour local to this form.
      if (err && typeof err === 'object' && 'fieldErrors' in err) {
        const fieldErrors = (err as { fieldErrors: Record<string, string[]> }).fieldErrors
        setPasswordError((fieldErrors.password ?? [])[0] ?? null)
        setConfirmError((fieldErrors.confirmPassword ?? [])[0] ?? null)
        const field =
          fieldErrors.confirmPassword?.[0] != null
            ? 'confirmPassword'
            : fieldErrors.password?.[0] != null
              ? 'password'
              : null
        if (field) focusField(field)
      }
    },
    [focusField],
  )

  // When a submission fails, surface the categorised error through the same
  // accessible announcement so it is both visible and focusable (#145).
  useEffect(() => {
    if (resetSubmit.submissionError?.kind === 'validation') {
      handleResetError(resetSubmit.submissionError.cause)
    }
  }, [resetSubmit.submissionError, handleResetError])

  if (state.step === 'reset') {
    return (
      <form
        onSubmit={handleResetSubmit}
        noValidate
        className="flex flex-col gap-4"
        aria-labelledby="reset-password-heading"
      >
        <h2 id="reset-password-heading" className="text-h3">
          Choose a new password
        </h2>

        <Input
          id="reset-password-password"
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          error={fieldError('password')}
          hint={password.length === 0 ? 'Use at least 8 characters with a letter and a number.' : undefined}
          required
          onChange={(event) => setPassword(event.target.value)}
        />

        <Input
          id="reset-password-confirm"
          label="Confirm new password"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          value={confirmPassword}
          error={fieldError('confirmPassword') ?? mismatchHint ?? undefined}
          hint={confirmPassword.length === 0 ? 'Re-enter the new password above.' : undefined}
          required
          onChange={(event) => setConfirmPassword(event.target.value)}
        />

        {/* Shared accessible announcement for mismatch / invalid-password
            feedback. It is focusable as a fallback when the field itself is
            hard to reach, and it is labelled as the live error region for the
            form. */}
        {(passwordError || confirmError || mismatchHint) && (
          <p
            id={errorAnnouncerId}
            role="alert"
            aria-live="assertive"
            className="text-caption-sm text-danger"
          >
            {passwordError ?? confirmError ?? mismatchHint}
          </p>
        )}

        <Button
          type="submit"
          className="w-full justify-center"
          disabled={resetSubmit.isSubmitting}
        >
          {resetSubmit.submitLabel(resetLabel)}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleRequestSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        error={emailError ?? undefined}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button type="submit" className="w-full justify-center" disabled={requestSubmit.isSubmitting}>
        {requestSubmit.submitLabel(requestLabel)}
      </Button>
    </form>
  )
}
