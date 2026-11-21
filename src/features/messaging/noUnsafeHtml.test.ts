import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MessageComposer from './components/MessageComposer'
import ThreadConversationView from './components/ThreadConversationView'
import type { Message } from './types'
import { sanitizeMessageBody } from './utils'

/**
 * Message bodies, attachment names and link previews are attacker-controlled as
 * soon as a thread involves someone the user does not know. This guards the
 * ways untrusted content could reach the DOM as markup or as executable code:
 *
 *  1. `dangerouslySetInnerHTML` / `innerHTML` / `eval` anywhere in the feature.
 *  2. markup being interpreted by a renderer instead of shown as text, covered
 *     by rendering the messaging components with hostile bodies.
 *  3. a `javascript:` / `data:` URL reaching an `href`, covered by the
 *     `isSafePreviewUrl` allowlist in `utils.test.ts`.
 *
 * React escapes interpolated text by default, so rule 1 is really a rule about
 * this feature never opting out of that escaping. The rendering cases make that
 * contract executable rather than implied.
 *
 * The sources are collected with `import.meta.glob` rather than `node:fs`.
 * `tsconfig.app.json` sets `types: ["vite/client"]`, so a filesystem walk would
 * not type-check, and Vite's glob is the mechanism this project already has
 * types for. It also picks up newly added files without editing a list.
 *
 * JSX is avoided with `createElement` because this guard intentionally lives in
 * a `.ts` file (see the issue that owns this test).
 */
const sources = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Markup that would execute if any renderer treated a body as HTML. */
const HOSTILE_BODY = '<img src=x onerror="alert(1)"> <script>alert(2)</script> hello'

function transcriptMessage(body: string): {
  id: string
  senderId: string
  senderName: string
  body: string
  createdAt: Date
} {
  return {
    id: 'm1',
    senderId: 'mallory',
    senderName: 'Mallory',
    body,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
  }
}

function composerMessage(body: string): Message {
  return {
    id: 'm1',
    threadId: 'thread-1',
    senderId: 'mallory',
    body,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    status: 'sent',
    attachments: [],
  }
}

function expectNoMarkupExecuted() {
  expect(document.querySelector('img')).toBeNull()
  expect(document.querySelector('script')).toBeNull()
  expect(document.querySelector('[onerror]')).toBeNull()
}

describe('messaging renders untrusted content as text only', () => {
  it('finds the feature sources it guards', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0)
  })

  it('never opts out of React escaping', () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => /dangerouslySetInnerHTML|\.innerHTML\b/.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('never evaluates or compiles message content', () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => /\beval\s*\(|new\s+Function\s*\(/.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('has no unescaped-interpolation sink other than the validated preview href', () => {
    // `href` must be fed from a preview that went through the allowlist.
    const composer = sources['./components/MessageComposer.tsx']
    expect(composer).toBeTypeOf('string')
    expect(composer).toMatch(/composer\.preview\.href/)
    expect(composer).not.toMatch(/href=\{[^}]*\.(body|name)\b/)
  })

  it('renders hostile markup as literal text in the transcript', () => {
    render(
      createElement(ThreadConversationView, {
        messages: [transcriptMessage(HOSTILE_BODY)],
        currentUserId: 'me',
      }),
    )

    expect(screen.getByText(HOSTILE_BODY)).toBeInTheDocument()
    expectNoMarkupExecuted()
    expect(document.querySelector('a')).toBeNull()
  })

  it('renders hostile markup as literal text in the composer transcript', () => {
    render(
      createElement(MessageComposer, {
        threadId: 'thread-1',
        currentUserId: 'me',
        initialMessages: [composerMessage(HOSTILE_BODY)],
      }),
    )

    expect(screen.getByText(HOSTILE_BODY)).toBeInTheDocument()
    expectNoMarkupExecuted()
  })

  it('does not turn a scripting URL in a message into a link', () => {
    render(
      createElement(ThreadConversationView, {
        messages: [transcriptMessage('javascript:alert(1)')],
        currentUserId: 'me',
      }),
    )

    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(document.querySelector('a')).toBeNull()
  })

  it('keeps text readable by stripping invisible controls before rendering', () => {
    render(
      createElement(ThreadConversationView, {
        messages: [transcriptMessage('pay\u202Eevil')],
        currentUserId: 'me',
      }),
    )

    expect(screen.getByText('payevil')).toBeInTheDocument()
  })

  it('sanitises without removing markup that must stay visible as text', () => {
    expect(sanitizeMessageBody(HOSTILE_BODY)).toBe(HOSTILE_BODY)
  })
})
