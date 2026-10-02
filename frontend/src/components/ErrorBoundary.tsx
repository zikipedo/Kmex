import { RotateCcw, TriangleAlert } from 'lucide-react'
import React from 'react'
import { Button, Card } from './ui'

type State = { error: Error | null }

/** Isole les erreurs d'affichage d'une page : le reste de l'application reste utilisable. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[StockPro] Erreur d’affichage', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-xl px-4 py-20">
        <Card glow className="p-8 text-center">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-warn/15 text-warn">
            <TriangleAlert size={26} />
          </div>
          <h2 className="text-lg font-semibold">Cet écran a rencontré un problème</h2>
          <p className="mt-2 text-[13.5px] text-muted">Vos données ne sont pas affectées. Rechargez l’écran ; si le problème persiste, contactez le support.</p>
          <p className="mt-3 font-mono text-[11px] text-muted/70">{this.state.error.message}</p>
          <Button className="mt-6" icon={<RotateCcw size={16} />} onClick={() => this.setState({ error: null })}>
            Réessayer
          </Button>
        </Card>
      </div>
    )
  }
}
