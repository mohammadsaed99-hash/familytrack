import React, { useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import {
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from './firebase'

function generateFamilyCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''

  for (let i = 0; i < 6; i++) {
    code += characters.charAt(
      Math.floor(Math.random() * characters.length)
    )
  }

  return code
}

function App() {
  const [role, setRole] = useState(null)
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [user, setUser] = useState(null)
  const [familyCode, setFamilyCode] = useState('')

  const handleEmailAuth = async () => {
    setMessage('')

    try {
      if (mode === 'login') {
        const result = await signInWithEmailAndPassword(
          auth,
          email,
          password
        )

        setUser(result.user)
      } else {
        const result = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        )

        setUser(result.user)
      }
    } catch (error) {
      setMessage(error.message)
    }
  }

  const handleGoogleLogin = async () => {
    setMessage('')

    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)

      setUser(result.user)
    } catch (error) {
      setMessage(error.message)
    }
  }

  const handleCreateFamily = async () => {
    setMessage('')

    try {
      if (!user) {
        setMessage('Please login first.')
        return
      }

      const code = generateFamilyCode()

      await setDoc(doc(db, 'families', code), {
        familyCode: code,
        parentId: user.uid,
        parentEmail: user.email,
        createdAt: serverTimestamp(),
        children: [],
      })

      setFamilyCode(code)
      setMessage('Family created successfully!')
    } catch (error) {
      setMessage(error.message)
    }
  }

  const handleLogout = () => {
    setUser(null)
    setFamilyCode('')
    setMessage('')
  }

  if (user) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>📍</div>

          <h1 style={styles.title}>FamilyTrack</h1>

          <p style={styles.subtitle}>
            Family safety made simple
          </p>

          <h2 style={styles.question}>
            {role === 'parent'
              ? 'Parent Dashboard'
              : 'Child Dashboard'}
          </h2>

          <div style={styles.dashboardBox}>
            <p style={styles.dashboardTitle}>
              Welcome!
            </p>

            <p style={styles.dashboardText}>
              {user.email}
            </p>
          </div>

          {role === 'parent' && (
            <>
              {!familyCode ? (
                <button
                  style={styles.button}
                  onClick={handleCreateFamily}
                >
                  🏠 Create Family
                </button>
              ) : (
                <div style={styles.familyBox}>
                  <p style={styles.familyTitle}>
                    Your Family Code
                  </p>

                  <div style={styles.familyCode}>
                    {familyCode}
                  </div>

                  <p style={styles.familyText}>
                    Give this code to your child to join
                    your family.
                  </p>
                </div>
              )}
            </>
          )}

          {message && (
            <p
              style={
                message.includes('successfully')
                  ? styles.successMessage
                  : styles.message
              }
            >
              {message}
            </p>
          )}

          <button
            style={styles.button}
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </div>
    )
  }

  if (role) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>📍</div>

          <h1 style={styles.title}>FamilyTrack</h1>

          <p style={styles.subtitle}>
            {role === 'parent'
              ? 'Parent Account'
              : 'Child Account'}
          </p>

          <h2 style={styles.question}>
            {mode === 'login'
              ? 'Login'
              : 'Create Account'}
          </h2>

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

          <button
            style={styles.button}
            onClick={handleEmailAuth}
          >
            {mode === 'login'
              ? 'Login'
              : 'Create Account'}
          </button>

          <button
            style={styles.googleButton}
            onClick={handleGoogleLogin}
          >
            Continue with Google
          </button>

          {message && (
            <p style={styles.message}>
              {message}
            </p>
          )}

          <button
            style={styles.linkButton}
            onClick={() => {
              setMode(
                mode === 'login'
                  ? 'signup'
                  : 'login'
              )
              setMessage('')
            }}
          >
            {mode === 'login'
              ? 'Create a new account'
              : 'Already have an account? Login'}
          </button>

          <button
            style={styles.backButton}
            onClick={() => {
              setRole(null)
              setMode('login')
              setMessage('')
            }}
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
    marginBottom: '25px',
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

  googleButton: {
    width: '100%',
    padding: '15px',
    marginBottom: '12px',
    border: '1px solid #ddd',
    borderRadius: '12px',
    background: 'white',
    color: '#333',
    fontSize: '17px',
    cursor: 'pointer',
  },

  message: {
    color: '#d00',
    fontSize: '14px',
    lineHeight: '1.5',
    margin: '10px 0',
    wordBreak: 'break-word',
  },

  successMessage: {
    color: '#16803c',
    fontSize: '14px',
    lineHeight: '1.5',
    margin: '10px 0',
  },

  linkButton: {
    width: '100%',
    padding: '10px',
    border: 'none',
    background: 'transparent',
    color: '#2563eb',
    fontSize: '15px',
    cursor: 'pointer',
  },

  backButton: {
    width: '100%',
    padding: '12px',
    marginTop: '8px',
    border: 'none',
    background: 'transparent',
    color: '#555',
    fontSize: '16px',
    cursor: 'pointer',
  },

  dashboardBox: {
    background: '#f5f7fa',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
  },

  dashboardTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    margin: '0 0 10px',
  },

  dashboardText: {
    fontSize: '14px',
    color: '#555',
    margin: '0',
    wordBreak: 'break-word',
  },

  familyBox: {
    background: '#eff6ff',
    borderRadius: '15px',
    padding: '20px',
    marginBottom: '20px',
  },

  familyTitle: {
    fontSize: '17px',
    fontWeight: 'bold',
    margin: '0 0 15px',
  },

  familyCode: {
    fontSize: '30px',
    fontWeight: 'bold',
    letterSpacing: '5px',
    color: '#2563eb',
    marginBottom: '12px',
  },

  familyText: {
    fontSize: '14px',
    color: '#555',
    margin: '0',
    lineHeight: '1.5',
  },
}

export default App
