import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { registerSchema } from './schemas'
import { passwordSchema, resetPasswordSchema } from './utils'

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Str0ngPass',
  confirmPassword: 'Str0ngPass',
  accountType: 'artist',
}

function fieldErrors(input: Record<string, unknown>) {
  const result = registerSchema.safeParse(input)
  return result.success ? {} : z.flattenError(result.error).fieldErrors
}

describe('registerSchema', () => {
  it('accepts valid input and trims name/email', () => {
    const result = registerSchema.parse({ ...valid, name: '  Ada  ', email: ' ada@example.com ' })
    expect(result.name).toBe('Ada')
    expect(result.email).toBe('ada@example.com')
  })

  it('requires a name of at least 2 characters', () => {
    expect(fieldErrors({ ...valid, name: ' a ' }).name).toBeDefined()
  })

  it('rejects an invalid email', () => {
    expect(fieldErrors({ ...valid, email: 'not-an-email' }).email).toBeDefined()
  })

  it.each([
    ['too short', 'Ab1'],
    ['no uppercase', 'weakpass1'],
    ['no lowercase', 'WEAKPASS1'],
    ['no number', 'WeakPassword'],
  ])('rejects a weak password (%s)', (_, password) => {
    expect(fieldErrors({ ...valid, password, confirmPassword: password }).password).toBeDefined()
  })

  it('rejects mismatched passwords on confirmPassword', () => {
    const errors = fieldErrors({ ...valid, confirmPassword: 'Different1' })
    expect(errors.confirmPassword).toEqual(['Passwords do not match.'])
  })

  it('requires an account type of artist or client', () => {
    expect(fieldErrors({ ...valid, accountType: undefined }).accountType).toBeDefined()
    expect(fieldErrors({ ...valid, accountType: 'admin' }).accountType).toBeDefined()
    expect(registerSchema.safeParse({ ...valid, accountType: 'client' }).success).toBe(true)
  })
})

const resetValid = {
  password: 'Str0ngPass',
  confirmPassword: 'Str0ngPass',
} as const

function resetFieldErrors(input: Record<string, unknown>) {
  const result = resetPasswordSchema.safeParse(input)
  return result.success ? {} : z.flattenError(result.error).fieldErrors
}

describe('resetPasswordSchema', () => {
  it('accepts matching, valid passwords', () => {
    expect(resetPasswordSchema.parse(resetValid)).toEqual(resetValid)
  })

  it('rejects an invalid password on the password field', () => {
    expect(
      resetFieldErrors({ ...resetValid, password: 'short' }).password,
    ).toBeDefined()
  })

  it.each([
    ['too short', 'Ab1'],
    ['no uppercase', 'weakpass1'],
    ['no lowercase', 'WEAKPASS1'],
    ['no number', 'WeakPassword'],
  ])('rejects a weak password on the password field (%s)', (_, password) => {
    expect(
      resetFieldErrors({ password, confirmPassword: password }).password,
    ).toBeDefined()
  })

  it('rejects mismatched passwords on confirmPassword', () => {
    const errors = resetFieldErrors({
      ...resetValid,
      confirmPassword: 'Different1',
    })
    expect(errors.confirmPassword).toEqual(['Passwords do not match.'])
  })

  it('keeps the mismatch error on confirmPassword even when the password is weak', () => {
    const errors = resetFieldErrors({
      password: 'weak',
      confirmPassword: 'different',
    })
    // Both fields are invalid, but the mismatch is surfaced on confirmPassword.
    expect(errors.confirmPassword).toContain('Passwords do not match.')
  })

  it('rejects a missing confirmation', () => {
    const errors = resetFieldErrors({ password: resetValid.password, confirmPassword: '' })
    expect(errors.confirmPassword).toContain('Please confirm your new password.')
  })

  it('rejects overly long passwords and confirmations', () => {
    const long = 'a'.repeat(129)
    const errors = resetFieldErrors({ password: long, confirmPassword: long })
    expect(errors.password).toContain('Password must be at most 128 characters.')
    expect(errors.confirmPassword).toContain('Your confirmation is too long.')
  })
})
