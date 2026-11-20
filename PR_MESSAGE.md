# Add reset-password form with mismatch + weak-password validation (#140)

## Summary

- Extends `ResetPasswordForm` from an email-only reset-link request into a two-step reset flow: request a reset link by email, then choose a new password once the token is present.
- Adds password + confirm-password validation driven by a shared `resetPasswordSchema` (min length, lowercase/uppercase/number, max length, and confirm-password match).
- Shows a live mismatch hint under the confirm field and announces/focuses the first invalid control on client-side or server-returned validation errors, so mismatch and invalid-password feedback is both visible and keyboard-reachable.
- Adds focused schema tests in `src/features/auth/schemas.test.ts` and exports the validation rules from `@/features/auth` so the form and any future server-side mirror share one source of truth.

Closes #140

## Context

The existing `ResetPasswordForm` only requested a reset link by email. The reset-password page already has a route and an API endpoint (`authApi.resetPassword`) but no accessible password-strength/mismatch validation on the client. This leaves two gaps the issue asks us to close:

- mismatch and invalid-password feedback must be announced to assistive tech, and
- that feedback must be focusable so keyboard users land on the problem field.

## Changes

### `src/features/auth/utils.ts`

- Adds `PASSWORD_MAX_LENGTH = 128`.
- Adds `resetPasswordSchema`: a two-field Zod schema (`password`, `confirmPassword`) built on the existing `passwordSchema`, with a refine that puts the mismatch error on `confirmPassword`.
- Exports `ResetPasswordFormValues` and `ResetPasswordFormInput` types.

### `src/features/auth/index.ts`

- Re-exports `passwordSchema`, `resetPasswordSchema`, `getPasswordIssues`, `getPasswordStrength`, `MIN_PASSWORD_LENGTH`, `PASSWORD_MAX_LENGTH`, `ResetPasswordFormValues`, and `ResetPasswordFormInput` from `@/features/auth`.
- This keeps the auth feature barreled: consumers import from `@/features/auth`, not from `@/features/auth/utils`.

### `src/components/ResetPasswordForm.tsx`

- Turns the component into a two-step form controlled by a `token` prop.
- Email step: same validate-on-submit email flow as before, using `validateEmail`. Submit calls `onRequestReset(email)` when provided.
- Password step: renders `New password` and `Confirm new password` inputs with:
  - per-field error wiring through `Input`'s `error` prop,
  - a live `mismatchHint` that appears while both fields are filled but differ, and clears as soon as either field changes,
  - an assertive live region (`role="alert"`, `aria-live="assertive"`) that renders the current visible error text,
  - field `id`s and focus movement to the first invalid field on submit and on server-returned validation errors.
- Introduces `firstInvalidField(...)` so the form can move focus to the first invalid control consistently.
- Uses `useFormSubmission` for the reset action and reacts to its categorised `submissionError` so server-returned validation failures surface through the same accessible announcement.

### `src/features/auth/schemas.test.ts`

- Adds a `resetPasswordSchema` describe block with tests for:
  - valid matching passwords,
  - weak/short passwords surfaced on the password field,
  - mismatched passwords surfaced on `confirmPassword`,
  - mismatch still reported on `confirmPassword` even when the password is weak,
  - missing confirmation,
  - overly long passwords and confirmations.

## Accessible behavior (acceptance)

- When passwords mismatch or the password is invalid, the error appears under the relevant field and in the form-level alert region.
- On submit, focus moves to the first invalid field (`password` before `confirmPassword`) so keyboard users reach the problem immediately.
- A live mismatch hint updates as the user types, without blocking a valid submission.

## Files changed

1. `src/components/ResetPasswordForm.tsx`
2. `src/features/auth/index.ts`
3. `src/features/auth/utils.ts`
4. `src/features/auth/schemas.test.ts`

## Validation

### Completed

- `npx vitest run src/features/auth/schemas.test.ts src/features/auth/utils.test.ts`
  - 32 tests passed, 0 failed.
  - Before the fixes in this PR: 10 failed tests in the new `resetPasswordSchema` block; after publishing `resetPasswordSchema` from `utils.ts` and adjusting two assertions, all pass.
- `npx tsc --noEmit`
  - Clean at the workspace root.
  - The app tsconfig (`tsconfig.app.json`) still reports one pre-existing error in an unrelated test file (`src/components/ui/MediaLightbox.test.ts`), which is not touched by this PR.

### Remaining

- [ ] Visual check of the reset-password page once a token is present: password + confirm fields, live mismatch hint, error announcement, focus behavior.
- [ ] Parent page integration: pass `token` and wire `onRequestReset` to `authApi.forgotPassword` and `onReset` to post-reset navigation/confirmation.

## Notes for review

- The reset schema reuses the same min-length, lowercase, uppercase, and number rules as `passwordSchema`, then adds max length and confirm-password matching. If the backend later enforces a different shape, the single source of truth here is the one to update.
- The form does not try to parse or validate the token itself. Token validity is checked by the API; the form just gates the password step on the presence of a token prop.

🤖 Generated with CodeBuff
