import React from 'react'
import ReactDOM from 'react-dom/client'

function App() {
  return (
    <div>
      <h1>FamilyTrack</h1>
      <p>Family safety and real-time location tracking</p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
