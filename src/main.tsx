import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useTacticalStore } from './store/useTacticalStore.ts'

if (typeof window !== 'undefined') {
  (window as any).useTacticalStore = useTacticalStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
