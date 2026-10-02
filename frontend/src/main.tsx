import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import { ConfirmHost } from './components/confirm'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: (count, err: any) => count < 1 && err?.status !== 403 && err?.status !== 404 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <ConfirmHost />
        <Toaster
          position="top-center"
          toastOptions={{
            classNames: {
              toast: 'glass-strong !rounded-2xl !border !text-fg !font-sans',
              description: '!text-muted',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)

// PWA : service worker (production uniquement) — démarrage et vente au comptoir sans réseau.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        const ping = () => (reg.active || navigator.serviceWorker.controller)?.postMessage('precache')
        if (reg.active) ping()
        else navigator.serviceWorker.ready.then(ping)
      })
      .catch(() => null)
  })
}
