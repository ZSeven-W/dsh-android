/**
 * Last-resort guard around every dsh-android conversation card. A throwing
 * slot component must never take down the conversation, so each registered
 * view is wrapped in this boundary and renders a static fallback card instead.
 */

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { CARD_STYLES } from './card-styles.js'

interface AndroidCardBoundaryProps {
  children: ReactNode
}

interface AndroidCardBoundaryState {
  failed: boolean
}

export class AndroidCardBoundary extends Component<AndroidCardBoundaryProps, AndroidCardBoundaryState> {
  constructor(props: AndroidCardBoundaryProps) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): AndroidCardBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('dsh-android: device card render failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <section style={CARD_STYLES.card} data-tool="dsh-android" data-state="unavailable">
        <div style={CARD_STYLES.head}><span>Android</span></div>
        <div style={CARD_STYLES.body}>
          <div style={CARD_STYLES.fallback} role="alert">
            <strong style={CARD_STYLES.fallbackTitle}>stream not available</strong>
            <span style={CARD_STYLES.muted}>The Android card failed to render.</span>
          </div>
        </div>
      </section>
    )
  }
}
