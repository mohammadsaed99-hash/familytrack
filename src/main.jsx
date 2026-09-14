import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import 'leaflet/dist/leaflet.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/familytrack/sw.js')
      .then(() => {
        console.log('FamilyTrack PWA service worker registered.')
      })
      .catch((error) => {
        console.error(
          'PWA service worker registration failed:',
          error
        )
      })
  })
}

ReactDOM.createRoot(
  document.getElementById('root')
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
