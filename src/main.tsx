import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

window.setTimeout(() => {
  document.getElementById('loading')?.classList.add('hidden')
}, 300)
