import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Modal, Spinner } from '@/components/ui'
import { http } from '@/services'
import { activeStellarNetwork, STELLAR_NETWORK_LABELS } from '@/config'
import { useWallet } from '@/features/auth/hooks/useWallet'
import { signWithConnectedWallet } from '@/features/auth/services/wallets'
import { getWalletConnection } from '@/features/auth/stores/walletStore'
import {
  createSigningRequestLock,
  isNetworkMismatch,
  isSigningCancellation,
  mapStellarError,
} from './transactionSigning'
import { shortAddress } from '@/lib'

interface TransactionSigningFlowProps {
  /** Checkout session ID */
  sessionId: string
  /** Callback when signing completes successfully */
  onSuccess?: (txHash: string) => void
  /** Callback when user rejects signing */
  onReject?: () => void
  /** Callback when signing fails */
  onError?: (error: Error) => void
}

type SigningStep =
  | 'preparing'
  | 'waiting_for_wallet'
  | 'signing'
  | 'submitting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  // Paused rather than failed: the prepared XDR is still valid once the
  // wallet comes back, so the flow resumes instead of restarting.
  | 'paused'

/** Steps where a signing attempt is already in flight. */
const IN_FLIGHT_STEPS: SigningStep[] = ['signing', 'submitting']

type SessionRequest = {
  sessionId: string
  generation: number
}

type SubmitRequest = SessionRequest & {
  signedXdr: string
}

// ---------------------------------------------------------------------------
// Stellar error mapping (#718)
// ---------------------------------------------------------------------------

/** Human-readable copy for the failure modes a wallet can actually produce. */
export interface NetworkBadgeProps {
  className?: string
}

/**
 * Persistent indicator of which network this build talks to.
 *
 * The value comes only from env config, and testnet gets its own accent so it
 * is never mistaken for production.
 */
export function NetworkBadge({ className = '' }: NetworkBadgeProps) {
  const isTestnet = activeStellarNetwork === 'testnet'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption-xs font-semibold ${
        isTestnet
          ? 'bg-warning/15 text-warning ring-1 ring-warning/40'
          : 'bg-primary/10 text-primary'
      } ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isTestnet ? 'bg-warning' : 'bg-primary'}`}
        aria-hidden="true"
      />
      {STELLAR_NETWORK_LABELS[activeStellarNetwork]}
      {isTestnet && <span className="font-normal">· no real funds</span>}
    </span>
  )
}

export default function TransactionSigningFlow({
  sessionId,
  onSuccess,
  onReject,
  onError,
}: TransactionSigningFlowProps) {
  const { publicKey, isConnected } = useWallet()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<SigningStep>('preparing')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signedXdr, setSignedXdr] = useState<string | null>(null)
  const signingLock = useRef(createSigningRequestLock()).current
  const [isSigningPending, setIsSigningPending] = useState(false)
  const [networkMismatch, setNetworkMismatch] = useState(false)
  const [needsMainnetConfirm, setNeedsMainnetConfirm] = useState(false)
  const [stateSessionId, setStateSessionId] = useState(sessionId)
  const activeSessionId = useRef(sessionId)
  const sessionGeneration = useRef(0)

  const { mutate: prepare } = useMutation({
    mutationFn: async ({
      sessionId: requestSessionId,
    }: SessionRequest): Promise<{ xdr: string; txHash: string }> => {
      const response = await http.post<{ xdr: string; txHash: string }>(
        `/payments/${requestSessionId}/prepare`,
      )
      return response
    },
    onSuccess: (data, variables) => {
      if (
        variables.sessionId !== activeSessionId.current ||
        variables.generation !== sessionGeneration.current
      )
        return
      setStateSessionId(variables.sessionId)
      setSignedXdr(data.xdr)
      setTxHash(data.txHash)
      setStep('waiting_for_wallet')
    },
    onError: (err, variables) => {
      if (
        variables.sessionId !== activeSessionId.current ||
        variables.generation !== sessionGeneration.current
      )
        return
      setStateSessionId(variables.sessionId)
      setError(err instanceof Error ? err.message : 'Failed to prepare transaction')
      setStep('failed')
    },
  })

  const submitMutation = useMutation({
    mutationFn: async ({
      sessionId: requestSessionId,
      signedXdr,
    }: SubmitRequest): Promise<{ txHash: string }> => {
      const response = await http.post<{ txHash: string }>(`/payments/${requestSessionId}/submit`, {
        signedXdr,
      })
      return response
    },
    onSuccess: (data, variables) => {
      if (
        variables.sessionId !== activeSessionId.current ||
        variables.generation !== sessionGeneration.current
      )
        return
      setStateSessionId(variables.sessionId)
      setTxHash(data.txHash)
      setStep('completed')
      queryClient.invalidateQueries({ queryKey: ['paymentResult', sessionId] })
      onSuccess?.(data.txHash)
    },
    onError: (err, variables) => {
      if (
        variables.sessionId !== activeSessionId.current ||
        variables.generation !== sessionGeneration.current
      )
        return
      setStateSessionId(variables.sessionId)
      setError(err instanceof Error ? err.message : 'Failed to submit transaction')
      setStep('failed')
    },
  })

  const isCurrentSession = stateSessionId === sessionId
  const currentStep = isCurrentSession ? step : 'preparing'
  const currentTxHash = isCurrentSession ? txHash : null
  const currentError = isCurrentSession ? error : null
  const currentSignedXdr = isCurrentSession ? signedXdr : null
  const currentIsSigningPending = isCurrentSession ? isSigningPending : false
  const currentNetworkMismatch = isCurrentSession ? networkMismatch : false
  const currentNeedsMainnetConfirm = isCurrentSession ? needsMainnetConfirm : false

  const handleSign = useCallback(async () => {
    if (!currentSignedXdr) return
    // A wallet on the wrong network cannot produce a valid signature here.
    const connection = getWalletConnection()
    if (isNetworkMismatch(connection?.networkPassphrase)) {
      setNetworkMismatch(true)
      setStep('paused')
      return
    }

    // Mainnet payments get an explicit confirmation before anything is signed.
    if (activeStellarNetwork === 'mainnet' && !currentNeedsMainnetConfirm) {
      setNeedsMainnetConfirm(true)
      return
    }

    if (!signingLock.tryAcquire()) return

    setIsSigningPending(true)
    setStep('signing')
    setError(null)
    const generation = sessionGeneration.current

    try {
      if (!connection) {
        // Paused, not aborted — the prepared XDR survives a reconnect.
        setStep('paused')
        return
      }

      const signed = await signWithConnectedWallet(currentSignedXdr)
      setStep('submitting')
      await submitMutation.mutateAsync({ sessionId, generation, signedXdr: signed })
      if (generation !== sessionGeneration.current) return
      setNeedsMainnetConfirm(false)
    } catch (err) {
      if (generation !== sessionGeneration.current) return
      const message = mapStellarError(err)
      if (isSigningCancellation(err)) {
        setStep('cancelled')
        setError(message)
        onReject?.()
      } else {
        setStep('failed')
        setError(message)
        onError?.(new Error(message))
      }
    } finally {
      signingLock.release()
      if (generation === sessionGeneration.current) setIsSigningPending(false)
    }
  }, [
    currentSignedXdr,
    submitMutation,
    onReject,
    onError,
    currentNeedsMainnetConfirm,
    signingLock,
    sessionId,
  ])

  const resumeAfterReconnect = useCallback(() => {
    const connection = getWalletConnection()
    if (!connection) return
    if (isNetworkMismatch(connection.networkPassphrase)) {
      setNetworkMismatch(true)
      return
    }
    setNetworkMismatch(false)
    setStep('waiting_for_wallet')
  }, [])

  // A signing flow can be reused for a different checkout session without unmounting.
  // The render derives the preparing state until the new request completes; late callbacks
  // from the old generation are ignored by the mutation guards above.
  useEffect(() => {
    const generation = sessionGeneration.current + 1
    sessionGeneration.current = generation
    activeSessionId.current = sessionId
    prepare({ sessionId, generation })
  }, [sessionId, prepare])

  if (!isConnected) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 shadow-card text-center">
        <svg
          className="h-16 w-16 mx-auto text-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </svg>
        <h2 className="mt-4 text-h3">Connect Your Wallet</h2>
        <p className="mt-2 text-caption text-muted">
          You need to connect a Stellar wallet to sign this transaction.
        </p>
      </div>
    )
  }

  const stepLabels: Record<SigningStep, string> = {
    preparing: 'Preparing transaction…',
    waiting_for_wallet: 'Ready to sign',
    signing: 'Pending — waiting for wallet signature…',
    submitting: 'Pending — submitting to network…',
    completed: 'Transaction submitted!',
    failed: 'Signing failed',
    cancelled: 'Signing cancelled',
    paused: 'Paused — waiting for your wallet',
  }

  // Never offer a second sign while one is running.
  const signDisabled =
    currentIsSigningPending || IN_FLIGHT_STEPS.includes(currentStep) || currentNetworkMismatch

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <NetworkBadge />
      </div>
      <div className="mb-6">
        <div className="h-2 bg-line rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{
              width: `${['preparing', 'waiting_for_wallet', 'signing', 'submitting', 'completed'].indexOf(currentStep) + 1} * 20%`,
            }}
          />
        </div>
        <p className="mt-2 text-caption text-muted text-center">{stepLabels[currentStep]}</p>
      </div>

      {currentStep === 'preparing' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Spinner className="h-10 w-10" />
          <p className="text-caption text-muted">Building transaction…</p>
        </div>
      )}

      {currentStep === 'waiting_for_wallet' && (
        <div className="space-y-4">
          <div className="rounded-control bg-surface-muted p-4 text-left">
            <p className="text-caption-sm font-medium text-foreground mb-2">Transaction Details</p>
            <dl className="space-y-1 text-caption-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Status</dt>
                <dd className="font-mono">Ready to sign</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">TX Hash (predicted)</dt>
                <dd className="font-mono text-caption-xs">
                  {currentTxHash ? shortAddress(currentTxHash) : ''}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">From</dt>
                <dd className="font-mono text-caption-xs">
                  {publicKey ? shortAddress(publicKey) : ''}
                </dd>
              </div>
            </dl>
          </div>

          <div className="p-3 rounded-control bg-primary/10 border border-primary/30 text-caption-sm text-primary">
            <svg
              className="inline h-4 w-4 mr-1"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Review the transaction in your wallet before approving. The amount and recipient must
            match the checkout summary.
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={handleSign}
            isLoading={currentIsSigningPending || submitMutation.isPending}
            disabled={signDisabled}
          >
            Open Wallet & Sign
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStep('cancelled')
              setError('Transaction signing was cancelled. No payment was made.')
              onReject?.()
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {currentStep === 'signing' && (
        <div
          className="flex flex-col items-center gap-4 py-8"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Spinner className="h-10 w-10" />
          <p className="text-caption text-muted">Pending — waiting for wallet signature…</p>
          <p className="text-caption-xs text-muted">
            Please approve the transaction in your wallet popup.
          </p>
        </div>
      )}

      {currentStep === 'submitting' && (
        <div
          className="flex flex-col items-center gap-4 py-8"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Spinner className="h-10 w-10" />
          <p className="text-caption text-muted">Pending — broadcasting to Stellar network…</p>
        </div>
      )}

      {currentStep === 'completed' && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
            <svg
              className="h-8 w-8 text-success"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 className="text-h3">Transaction Submitted!</h3>
          <p className="text-caption text-muted">
            Your payment is being processed on the Stellar network.
          </p>
          {currentTxHash && (
            <div className="mt-4 p-3 rounded-control bg-surface-muted">
              <p className="text-caption-xs text-muted">Transaction Hash</p>
              <code className="font-mono text-caption-sm break-all">{currentTxHash}</code>
            </div>
          )}
        </div>
      )}

      {currentStep === 'cancelled' && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="h-16 w-16 rounded-full bg-surface-muted flex items-center justify-center">
            <svg
              className="h-8 w-8 text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h3 className="text-h3">Signing Cancelled</h3>
          <p className="text-caption text-muted">
            {currentError ?? 'Transaction signing was cancelled. No payment was made.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
            <Button
              className="flex-1"
              onClick={() => {
                setStep('waiting_for_wallet')
                setError(null)
              }}
            >
              Try Again
            </Button>
            <Button variant="ghost" className="flex-1" onClick={onReject}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {currentStep === 'failed' && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="h-16 w-16 rounded-full bg-danger/10 flex items-center justify-center">
            <svg
              className="h-8 w-8 text-danger"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h3 className="text-h3">Signing Failed</h3>
          <p className="text-caption text-danger">{currentError ?? 'Unknown error'}</p>
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
            <Button
              className="flex-1"
              onClick={() => {
                setStep('waiting_for_wallet')
                setError(null)
              }}
            >
              Try Again
            </Button>
            <Button variant="ghost" className="flex-1" onClick={onReject}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {currentStep === 'paused' && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="h-16 w-16 rounded-full bg-warning/10 flex items-center justify-center">
            <svg
              className="h-8 w-8 text-warning"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
            </svg>
          </div>
          <h3 className="text-h3">Payment paused</h3>
          <p className="text-caption text-muted">
            {currentNetworkMismatch
              ? `Your wallet is on a different network than this app. Switch your wallet to ${STELLAR_NETWORK_LABELS[activeStellarNetwork]} and reload.`
              : 'Your wallet disconnected. Reconnect to continue — your transaction is still prepared and nothing has been charged.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
            {currentNetworkMismatch ? (
              <Button className="flex-1" onClick={() => window.location.reload()}>
                Reload
              </Button>
            ) : (
              <Button className="flex-1" onClick={resumeAfterReconnect}>
                I reconnected
              </Button>
            )}
            <Button variant="ghost" className="flex-1" onClick={onReject}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <Modal
        isOpen={currentStep === 'waiting_for_wallet' && !isConnected}
        onClose={() => {
          setStep('failed')
          onReject?.()
        }}
        title="Wallet Disconnected"
        description="Your wallet was disconnected. Reconnect to continue — your transaction is still prepared."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setStep('failed')
              onReject?.()
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={resumeAfterReconnect}>
            Resume
          </Button>
        </div>
      </Modal>

      {/* Mainnet payments are confirmed explicitly before any signature. */}
      <Modal
        isOpen={currentNeedsMainnetConfirm && currentStep === 'waiting_for_wallet'}
        onClose={() => setNeedsMainnetConfirm(false)}
        title="Confirm mainnet payment"
        description="This sends real funds on the Stellar mainnet. It cannot be reversed once submitted."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setNeedsMainnetConfirm(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSign}>
            Sign on mainnet
          </Button>
        </div>
      </Modal>
    </div>
  )
}
