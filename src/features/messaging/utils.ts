import { safeExternalUrl } from '@/lib'
import type { LinkPreview, Message, MessageAttachment, MessageDraft } from './types'

/** Longest body the composer will send, mirroring the API's column limit. */
export const MAX_MESSAGE_LENGTH = 2000

/** Attachment chips beyond this are ignored rather than rendering unbounded UI. */
export const MAX_ATTACHMENTS = 4

/** Longest attachment label rendered; the rest is elided. */
const MAX_ATTACHMENT_NAME_LENGTH = 60

/** Bare-domain candidate (`www.`) or explicit URL. Stops at whitespace and markup. */
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/i

/** Punctuation that commonly ends a sentence rather than a URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/**
 * Characters that cannot be rendered as visible text and can make a message
 * read differently from its bytes: C0/C1 controls (newlines and tabs are
 * kept), zero-width spaces, bidi embeddings/overrides/isolates, and the BOM.
 *
 * ZWNJ/ZWJ (U+200C/U+200D) are deliberately kept: they are meaningful in
 * Persian and Arabic text and in emoji sequences.
 */
/* eslint-disable no-control-regex -- intentional control-character filtering */
const INVISIBLE_TEXT_CHARS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g
/* eslint-enable no-control-regex */

export type SendIntent = 'send' | 'newline' | 'ignore'

/**
 * Decides what Enter means inside the composer.
 *
 * - Plain <kbd>Enter</kbd> sends; <kbd>Shift</kbd>+<kbd>Enter</kbd> inserts a newline.
 * - While an IME candidate window is open, Enter *confirms the candidate* and
 *   must never send. Without this guard, composing Japanese or Chinese text
 *   would post a half-finished word.
 */
export function sendIntentForKey(key: string, shiftKey: boolean, isComposing: boolean): SendIntent {
  if (isComposing) return 'ignore'
  if (key !== 'Enter') return 'ignore'
  return shiftKey ? 'newline' : 'send'
}

/**
 * Makes an untrusted message body readable when it is rendered as text.
 *
 * Markup is deliberately *not* stripped: `<b>hi</b>` stays the literal text
 * the sender typed, and React escapes it on output, so it can never be
 * interpreted as HTML. Line endings are normalised, and invisible characters
 * that could reorder or disguise the visible text are removed so what is read
 * matches what is stored.
 */
export function sanitizeMessageBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').replace(INVISIBLE_TEXT_CHARS, '')
}

/** Trims a draft body for sending. Returns `''` for whitespace-only input. */
export function normalizeBody(body: string): string {
  return sanitizeMessageBody(body).trim()
}

/**
 * Whether a draft may be sent: it must carry text and fit the length limit.
 *
 * Whitespace-only input is rejected, so a stray space or newline can never
 * create an empty message.
 */
export function canSend(body: string): boolean {
  const normalized = normalizeBody(body)
  return normalized.length > 0 && normalized.length <= MAX_MESSAGE_LENGTH
}

/** Remaining characters the composer will accept, floored at zero. */
export function remainingLength(body: string): number {
  return Math.max(0, MAX_MESSAGE_LENGTH - normalizeBody(body).length)
}

/**
 * Whether a raw URL may be used as an `href`.
 *
 * Delegates to the app-wide external-URL policy: only `https:` is accepted in
 * production (`http:` is a development convenience), the URL must be absolute
 * and host-bearing, and embedded credentials (`https://user:pass@host`),
 * backslashes, control characters or surrounding whitespace are refused. The
 * last two matter here because a browser normalises them away, so the link a
 * reader sees could otherwise differ from the one in the DOM.
 */
export function isSafePreviewUrl(raw: string): boolean {
  return safeExternalUrl(raw) !== null
}

function toAbsoluteUrl(raw: string): string {
  // A bare `www.` host has no scheme, so `new URL` cannot parse it. Assume
  // https rather than http: never upgrade a guess into a plaintext request.
  return /^www\./i.test(raw) ? `https://${raw}` : raw
}

/**
 * Extracts preview metadata for the first link in a body.
 *
 * Returns `null` when the body contains no link. Returns a preview whose
 * `href` is `null` when the link is unsafe to navigate to, so the caller can
 * still show the URL as text instead of dropping the information.
 */
export function extractLinkPreview(body: string): LinkPreview | null {
  const match = URL_PATTERN.exec(body)
  const candidate = match?.[0] ?? ''
  const url = candidate.replace(TRAILING_PUNCTUATION, '')
  if (url === '') return null

  // `safeExternalUrl` returns the normalised URL, so the checked value and the
  // value placed in `href` are the same string rather than two parse results.
  return { url, href: safeExternalUrl(toAbsoluteUrl(url)) }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Coerces an untrusted attachment payload into renderable chips.
 *
 * The backend contract is not implemented yet, so this is deliberately
 * defensive: anything that is not the expected primitive shape is dropped
 * rather than rendered, a hostile scheme never becomes a link, and the list is
 * capped so a malformed payload cannot produce unbounded UI.
 */
export function normalizeAttachments(payload: unknown): MessageAttachment[] {
  if (!Array.isArray(payload)) return []

  const attachments: MessageAttachment[] = []
  for (const entry of payload) {
    if (attachments.length >= MAX_ATTACHMENTS) break
    if (typeof entry !== 'object' || entry === null) continue

    const record = entry as Record<string, unknown>
    if (!isNonEmptyString(record.id) || !isNonEmptyString(record.name)) continue
    if (!isNonEmptyString(record.url) || !isSafePreviewUrl(record.url)) continue

    const size = typeof record.size === 'number' ? record.size : Number(record.size)
    const contentType = isNonEmptyString(record.contentType)
      ? record.contentType
      : 'application/octet-stream'

    attachments.push({
      id: record.id,
      name: truncateAttachmentName(record.name),
      size: Number.isFinite(size) && size > 0 ? size : 0,
      contentType,
      url: record.url,
    })
  }

  return attachments
}

/** Shortens an attachment label for a single-line chip. */
export function truncateAttachmentName(name: string): string {
  const normalized = name.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_ATTACHMENT_NAME_LENGTH) return normalized
  return `${normalized.slice(0, MAX_ATTACHMENT_NAME_LENGTH - 1)}\u2026`
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** Formats a byte count for a chip, e.g. `1.4 MB`. */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${Math.round(value)} ${UNITS[0]}` : `${value.toFixed(1)} ${UNITS[unit]}`
}

/** Builds the in-flight message the UI shows immediately, before the server replies. */
export function createPendingMessage(
  draft: MessageDraft,
  context: { id: string; senderId: string; createdAt: Date },
): Message {
  return {
    id: context.id,
    threadId: draft.threadId,
    senderId: context.senderId,
    body: normalizeBody(draft.body),
    createdAt: context.createdAt,
    status: 'sending',
    attachments: draft.attachments,
  }
}

/**
 * Inserts a pending message into the thread.
 *
 * Ids are deduplicated so a double submit, or a refetch that already contains
 * the server record, cannot render the same message twice.
 */
export function appendPending(messages: Message[], pending: Message): Message[] {
  if (messages.some((message) => message.id === pending.id)) return messages
  // The optimistic entry is the newest message by definition; append it so it
  // never jumps above older sent messages when clocks differ slightly.
  return [...messages, pending]
}

/**
 * Swaps the optimistic entry for the server's record, in place.
 *
 * The position is preserved so a message that arrives out of order does not
 * jump. A pending id that is no longer present is ignored rather than appended,
 * because a dismissed failed send must not reappear on its own.
 */
export function confirmPending(
  messages: Message[],
  pendingId: string,
  saved: Omit<Message, 'status'>,
): Message[] {
  const index = messages.findIndex((message) => message.id === pendingId)
  if (index === -1) return messages

  const confirmed: Message = { ...saved, status: 'sent' }
  const next = [...messages]
  next[index] = confirmed
  return next
}

/**
 * Marks an in-flight message as failed.
 *
 * The message stays in the thread and keeps its text, which is what gives the
 * retry affordance something to act on; the user never loses what they typed.
 */
export function failPending(messages: Message[], pendingId: string, reason: string): Message[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.id !== pendingId) return message
    changed = true
    const failed: Message = { ...message, status: 'failed', failureReason: reason }
    return failed
  })
  return changed ? next : messages
}

/** Returns a failed message to the sending state so it can be retried. */
export function retryPending(messages: Message[], pendingId: string): Message[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.id !== pendingId || message.status !== 'failed') return message
    changed = true
    const retried: Message = { ...message, status: 'sending' }
    delete retried.failureReason
    return retried
  })
  return changed ? next : messages
}

/** Removes a message from the thread, used to dismiss a failed send. */
export function dismissMessage(messages: Message[], id: string): Message[] {
  const next = messages.filter((message) => message.id !== id)
  return next.length === messages.length ? messages : next
}

/** Ids of every message the composer currently offers a retry for. */
export function retryableIds(messages: Message[]): string[] {
  return messages.filter((message) => message.status === 'failed').map((message) => message.id)
}
