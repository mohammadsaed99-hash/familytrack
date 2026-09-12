import React, { useState } from 'react'

function App() {
  const [role, setRole] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (role) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>📍</div>
          <h1 style={styles.title}>FamilyTrack</h1>
          <p style={styles.subtitle}>
            {role === 'parent' ? 'Parent Login' : 'Child Login'}
          </p>

          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button style={styles.button}>
            Login
          </button>

          <button
            style={styles.backButton}
            onClick={() => setRole(null)}
          >
            ← Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>📍</div>

        <h1 style={styles.title}>FamilyTrack</h1>

        <p style={styles.subtitle}>
          Family safety made simple
        </p>

        <h2 style={styles.question}>
          Choose your account
        </h2>

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
    marginBottom: '30px',
  },

  question: {
    fontSize: '21px',
    marginBottom: '20px',
  },

  input: {
    width: '100%',
    padding: '14px',
    marginBottom: '12px',
    border: '1px solid #ddd',
    borderRadius: '10px',
    fontSize: '16px',
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

  backButton: {
    width: '100%',
    padding: '12px',
    border: 'none',
    background: 'transparent',
    color: '#555',
    fontSize: '16px',
    cursor: 'pointer',
  },
}

export default App
