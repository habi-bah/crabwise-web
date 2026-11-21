import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EmptyState, ErrorState, Spinner } from '@/components/ui'
import {
  conversationStatusFor,
  formatMessageTime,
  groupMessagesByDay,
  hasPrependedHistory,
  pollIntervalFor,
  preserveScrollTop,
  shouldStickToBottom,
  type ConversationMessage,
} from '../conversation'
import { sanitizeMessageBody } from '../utils'

export interface ThreadConversationViewProps {
  messages: readonly ConversationMessage[]
  /** The signed-in user, whose messages are aligned right. */
  currentUserId: string
  /**
   * Loads one page of older history. Resolves to `true` when older messages
   * were prepended, which is what triggers the scroll-anchor correction.
   */
  onLoadOlder?: () => Promise<boolean> | boolean
  /** Whether older history is available above the current window. */
  hasOlder?: boolean
  isLoadingOlder?: boolean
  /** Supplies a newer page on the poll cadence. */
  onRefresh?: () => void | Promise<unknown>
  /** Marks the thread as read while it is on screen and focused. */
  isFocused?: boolean
  /** True while the first page of the conversation is still loading. */
  isLoading?: boolean
  /** True when loading the conversation failed. */
  hasError?: boolean
  /** Retries the failed load, shown with the error state. */
  onRetry?: () => void
}

/**
 * Chat-style transcript for one conversation.
 *
 * Three behaviours are the point of this component, and each is delegated to a
 * pure helper in `../conversation` so it can be tested without a DOM:
 *
 *  - **Day separators** via `groupMessagesByDay`.
 *  - **Scroll anchoring** via `hasPrependedHistory` + `preserveScrollTop`: when
 *    older messages are prepended the content above grows, and scrolling by
 *    exactly that much keeps the reader's place. An appended message never
 *    applies that correction, so a reader who scrolled away stays put.
 *  - **Conditional auto-scroll** via `shouldStickToBottom`: new messages only
 *    pull the view down while the reader is already at the bottom.
 *
 * Loading, failure and an empty thread are also told apart by
 * `conversationStatusFor`, so an empty transcript is never shown while the
 * first page is still in flight or after the request failed.
 */
export default function ThreadConversationView({
  messages,
  currentUserId,
  onLoadOlder,
  hasOlder = false,
  isLoadingOlder = false,
  onRefresh,
  isFocused = true,
  isLoading = false,
  hasError = false,
  onRetry,
}: ThreadConversationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNearTop, setIsNearTop] = useState(false)

  /** Whether the reader was at the bottom when they last scrolled. */
  const stickToBottomRef = useRef(true)
  /** Previous message list, used to tell a prepend from an append. */
  const previousMessagesRef = useRef<readonly ConversationMessage[]>([])
  /** Content height after the previous list update, for the prepend anchor. */
  const previousHeightRef = useRef<number | undefined>(undefined)
  /**
   * Scroll metrics captured when older history is requested. Layout can change
   * between renders (fonts, images, a resize), so the height measured before the
   * request is more trustworthy than one from an earlier render.
   */
  const olderRequestAnchorRef = useRef<{ scrollTop: number; height: number } | null>(null)

  const requestOlder = useCallback(() => {
    const container = containerRef.current
    if (container) {
      olderRequestAnchorRef.current = {
        scrollTop: container.scrollTop,
        height: container.scrollHeight,
      }
    }
    return onLoadOlder?.()
  }, [onLoadOlder])

  const status = conversationStatusFor({
    isLoading,
    hasError,
    messageCount: messages.length,
  })
  const segments = groupMessagesByDay(messages, new Date())

  // Preserve the reader's place across a prepend, and follow new messages only
  // while the reader is at the bottom. Measured in a layout effect so both
  // corrections happen before the browser paints the new content.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const heightAfter = container.scrollHeight
    const prepended = hasPrependedHistory(previousMessagesRef.current, messages)
    const anchor = prepended ? olderRequestAnchorRef.current : null
    const heightBefore = anchor?.height ?? previousHeightRef.current
    if (prepended) olderRequestAnchorRef.current = null

    if (prepended && heightBefore !== undefined) {
      // Older history grew the content above the viewport. Scrolling by that
      // growth keeps the same message under the same pixel.
      const restored = preserveScrollTop(
        anchor?.scrollTop ?? container.scrollTop,
        heightBefore,
        heightAfter,
      )
      if (restored !== container.scrollTop) container.scrollTop = restored
    } else if (stickToBottomRef.current) {
      // Appending (or loading the first page) may only move a reader who is
      // already at the bottom. A scrolled-away reader is left untouched.
      container.scrollTop = heightAfter
    }

    previousMessagesRef.current = messages
    previousHeightRef.current = heightAfter
  }, [messages])

  useEffect(() => {
    const container = containerRef.current
    if (container) previousHeightRef.current = container.scrollHeight
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || status !== 'ready' || !onLoadOlder || !isNearTop || isLoadingOlder) return

    let cancelled = false
    void Promise.resolve(requestOlder()).then((prepended) => {
      if (!cancelled && prepended) setIsNearTop(false)
    })
    return () => {
      cancelled = true
    }
  }, [isLoadingOlder, isNearTop, onLoadOlder, requestOlder, status])

  useEffect(() => {
    if (!onRefresh) return
    const interval = pollIntervalFor({ isFocused, isActive: true })
    if (interval === false) return
    const handle = window.setInterval(() => void onRefresh(), interval)
    return () => window.clearInterval(handle)
  }, [isFocused, onRefresh])

  return (
    <div className="flex flex-col gap-3">
      {status === 'ready' ? (
        <div className="flex items-center justify-center">
          {isLoadingOlder ? (
            <Spinner className="h-4 w-4" />
          ) : hasOlder ? (
            <button
              type="button"
              onClick={() => void requestOlder()}
              className="text-caption-sm text-primary underline"
            >
              Load earlier messages
            </button>
          ) : (
            <span className="text-caption-xs text-muted">Beginning of conversation</span>
          )}
        </div>
      ) : null}

      <div
        ref={containerRef}
        aria-busy={status === 'loading'}
        className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto overscroll-contain pr-1 sm:max-h-[70vh]"
        onScroll={(event) => {
          const target = event.currentTarget
          setIsNearTop(target.scrollTop <= 32)
          stickToBottomRef.current = shouldStickToBottom(
            target.scrollTop,
            target.clientHeight,
            target.scrollHeight,
          )
        }}
      >
        {status === 'loading' ? (
          <div className="flex flex-col items-center gap-2 py-8 text-body text-muted">
            <Spinner label="Loading messages" />
            <p>Loading messages…</p>
          </div>
        ) : null}

        {status === 'error' ? (
          <ErrorState
            message="This conversation could not be loaded. Check your connection and try again."
            onRetry={onRetry}
            className="my-auto"
          />
        ) : null}

        {status === 'empty' ? (
          <EmptyState
            size="sm"
            title="No messages yet"
            description="Start the conversation by sending the first message."
          />
        ) : null}

        {status === 'ready'
          ? segments.map((segment) => (
              <section key={segment.key} className="flex flex-col gap-2">
                <div className="flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-caption-xs font-semibold uppercase tracking-wide text-muted">
                    {segment.label}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>

                {segment.messages.map((message) => {
                  const isOwn = message.senderId === currentUserId
                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                    >
                      {!isOwn ? (
                        <span className="px-1 text-caption-xs text-muted">
                          {message.senderName}
                        </span>
                      ) : null}
                      <div
                        className={`max-w-[85%] rounded-control px-3.5 py-2 shadow-card sm:max-w-[70%] ${
                          isOwn
                            ? 'bg-primary text-primary-contrast'
                            : 'bg-surface-muted text-foreground'
                        }`}
                      >
                        {/* Rendered as text: React escapes it and this feature never sets HTML. */}
                        <p className="whitespace-pre-wrap break-words text-body">
                          {sanitizeMessageBody(message.body)}
                        </p>
                      </div>
                      <time
                        dateTime={message.createdAt.toISOString()}
                        className="px-1 text-caption-xs text-muted"
                      >
                        {formatMessageTime(message.createdAt)}
                      </time>
                    </div>
                  )
                })}
              </section>
            ))
          : null}
      </div>
    </div>
  )
}
