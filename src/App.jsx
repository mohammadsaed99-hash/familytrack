import React, { useState } from 'react'

function App() {
  const [role, setRole] = useState(null)

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>📍</div>

        <h1 style={styles.title}>FamilyTrack</h1>

        <p style={styles.subtitle}>
          Family safety made simple
        </p>

        {!role ? (
          <>
            <h2 style={styles.question}>Who are you?</h2>

            <button
              style={styles.button}
              onClick={() => setRole('parent')}
            >
              👨‍👩‍👧 Parent
            </button>

            <button
              style={styles.button}
              onClick={() => setRole('child')}
            >
              👦 Child
            </button>
          </>
        ) : (
          <>
            <h2 style={styles.question}>
              {role === 'parent' ? 'Parent Account' : 'Child Account'}
            </h2>

            <p style={styles.text}>
              {role === 'parent'
                ? 'Monitor your family and keep everyone connected.'
                : 'Share your location safely with your family.'}
            </p>

            <button
              style={styles.button}
              onClick={() => setRole(null)}
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: '#f5f7fa',
    fontFamily: 'Arial, sans-serif',
    padding: '20px',
  },

  card: {
    width: '100%',
    maxWidth: '420px',
    background: 'white',
    borderRadius: '20px',
    padding: '40px 30px',
    textAlign: 'center',
    boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
  },

  logo: {
    fontSize: '50px',
    marginBottom: '10px',
  },

  title: {
    margin: '0',
    fontSize: '32px',
  },

  subtitle: {
    color: '#666',
    marginBottom: '35px',
  },

  question: {
    fontSize: '22px',
    marginBottom: '20px',
  },

  button: {
    width: '100%',
    padding: '15px',
    marginBottom: '12px',
    border: 'none',
    borderRadius: '12px',
    background: '#2563eb',
    color: 'white',
    fontSize: '17px',
    cursor: 'pointer',
  },

  text: {
    color: '#555',
    lineHeight: '1.6',
    marginBottom: '25px',
  },
}

export default App
