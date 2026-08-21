/**
 * Shared screenshot grant session for the dsh-android surfaces.
 *
 * POST `/_dsh/dsh-android/grant` `{kind:'screenshot', path}` → render the
 * minted origin-relative PNG. Same failure policy as the stream session:
 * an initial grant failure falls back with a retry; an img error after a
 * successful grant re-grants once automatically before falling back. Unmount
 * drops the img src.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  requestScreenshotGrant,
  type AndroidFetcher,
  type AndroidScreenshotMeta,
} from './protocol.js'

export type AndroidScreenshotPhase = 'granting' | 'live' | 'fallback'

export interface AndroidScreenshotSessionOptions {
  meta: AndroidScreenshotMeta
  fetcher?: AndroidFetcher
  /** Static fallback message shown once the auto-retry budget is spent. */
  unavailableCopy: string
}

export interface AndroidScreenshotSession {
  phase: AndroidScreenshotPhase
  screenshotUrl: string | undefined
  failure: string
  imgRef: RefObject<HTMLImageElement>
  /** Manual refresh: clear the auto-retry budget and re-grant. */
  refresh: () => void
  /** One automatic re-grant (img error), then the fallback. */
  retryOnce: () => void
}

/** Grant → PNG session shared by the screenshot card and the panel. */
export function useAndroidScreenshot(options: AndroidScreenshotSessionOptions): AndroidScreenshotSession {
  const { meta, fetcher, unavailableCopy } = options
  const [phase, setPhase] = useState<AndroidScreenshotPhase>('granting')
  const [grant, setGrant] = useState<{ screenshotUrl: string }>()
  const [failure, setFailure] = useState('')
  const [attempt, setAttempt] = useState(0)
  const autoRetriedRef = useRef(false)
  const generationRef = useRef(0)
  const imgRef = useRef<HTMLImageElement>(null)

  const autoReGrant = useCallback((): void => {
    if (autoRetriedRef.current) {
      setFailure(unavailableCopy)
      setPhase('fallback')
    } else {
      autoRetriedRef.current = true
      setAttempt(current => current + 1)
    }
  }, [unavailableCopy])

  const refresh = useCallback((): void => {
    autoRetriedRef.current = false
    setFailure('')
    setAttempt(current => current + 1)
  }, [])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    let disposed = false
    setPhase('granting')
    setGrant(undefined)
    setFailure('')

    void requestScreenshotGrant(fetcher ?? fetch, meta.path).then(result => {
      if (disposed || generation !== generationRef.current) return
      if (!result.ok) {
        setFailure(result.error)
        setPhase('fallback')
        return
      }
      setGrant(result.grant)
      setPhase('live')
    })

    return () => {
      disposed = true
      generationRef.current += 1
      imgRef.current?.removeAttribute('src')
    }
  }, [attempt, meta.path, autoReGrant, fetcher])

  return {
    phase,
    screenshotUrl: grant?.screenshotUrl,
    failure,
    imgRef,
    refresh,
    retryOnce: autoReGrant,
  }
}
