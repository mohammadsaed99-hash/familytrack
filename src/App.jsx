import { useEffect, useState } from 'react'

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'

import {
  collection,
  doc,
  getDocs,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'

import { auth, db } from './firebase'

function generateFamilyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''

  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }

  return code
}

function App() {
  const [role, setRole] = useState('')
  const [user, setUser] = useState(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [familyCode, setFamilyCode] = useState('')
  const [joinCode, setJoinCode] = useState('')

  const [children, setChildren] = useState([])

  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
    })

    return unsubscribe
  }, [])

  // Load children from Firestore
  useEffect(() => {
    if (!user || role !== 'parent' || !familyCode) {
      setChildren([])
      return
    }

    const loadChildren = async () => {
      try {
        const membersRef = collection(
          db,
          'families',
          familyCode,
          'members'
        )

        const snapshot = await getDocs(membersRef)

        const childList = snapshot.docs.map((memberDoc) => ({
          id: memberDoc.id,
          ...memberDoc.data(),
        }))

        setChildren(childList)
      } catch (error) {
        setMessage(error.message)
      }
    }

    loadChildren()
  }, [user, role, familyCode])

  const handleEmailLogin = async () => {
    setMessage('')

    if (!email || !password) {
      setMessage('Please enter email and password.')
      return
    }

    try {
      setLoading(true)

      await signInWithEmailAndPassword(auth, email, password)

      setMessage('Login successful!')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async () => {
    setMessage('')

    if (!email || !password) {
      setMessage('Please enter email and password.')
      return
    }

    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.')
      return
    }

    try {
      setLoading(true)

      await createUserWithEmailAndPassword(auth, email, password)

      setMessage('Account created successfully!')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setMessage('')

    try {
      setLoading(true)

      const provider = new GoogleAuthProvider()

      await signInWithPopup(auth, provider)

      setMessage('Google login successful!')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateFamily = async () => {
    setMessage('')

    if (!user) {
      setMessage('Please login first.')
      return
    }

    try {
      setLoading(true)

      const code = generateFamilyCode()

      await setDoc(doc(db, 'families', code), {
        familyCode: code,
        parentId: user.uid,
        parentEmail: user.email,
        createdAt: serverTimestamp(),
      })

      setFamilyCode(code)
      setMessage('Family created successfully!')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleJoinFamily = async () => {
    setMessage('')

    if (!user) {
      setMessage('Please login first.')
      return
    }

    const code = joinCode.trim().toUpperCase()

    if (code.length !== 6) {
      setMessage('Please enter the 6-character Family Code.')
      return
    }

    try {
      setLoading(true)

      const familyRef = doc(db, 'families', code)
      const familySnapshot = await getDoc(familyRef)

      if (!familySnapshot.exists()) {
        setMessage('Family not found. Check the Family Code.')
        return
      }

      const family = familySnapshot.data()

      if (family.parentId === user.uid) {
        setMessage('You are already the parent of this family.')
        return
      }

      await setDoc(
        doc(db, 'families', code, 'members', user.uid),
        {
          userId: user.uid,
          email: user.email,
          role: 'child',
          joinedAt: serverTimestamp(),
        }
      )

      setFamilyCode(code)
      setMessage('You joined the family successfully!')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await signOut(auth)

    setUser(null)
    setFamilyCode('')
    setJoinCode('')
    setChildren([])
    setMessage('')
  }

  const styles = {
    page: {
      minHeight: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      background: '#f5f7fa',
      fontFamily: 'Arial, sans-serif',
    },

    card: {
      width: '100%',
      maxWidth: '450px',
      background: '#ffffff',
      borderRadius: '18px',
      padding: '30px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
    },

    title: {
      textAlign: 'center',
      marginBottom: '10px',
      color: '#222',
    },

    subtitle: {
      textAlign: 'center',
      color: '#666',
      marginBottom: '25px',
    },

    input: {
      width: '100%',
      padding: '13px',
      marginBottom: '12px',
      borderRadius: '10px',
      border: '1px solid #ddd',
      fontSize: '16px',
    },

    button: {
      width: '100%',
      padding: '13px',
      marginBottom: '10px',
      borderRadius: '10px',
      border: 'none',
      background: '#2563eb',
      color: '#fff',
      fontSize: '16px',
      cursor: 'pointer',
    },

    secondaryButton: {
      width: '100%',
      padding: '13px',
      marginBottom: '10px',
      borderRadius: '10px',
      border: '1px solid #ddd',
      background: '#fff',
      color: '#222',
      fontSize: '16px',
      cursor: 'pointer',
    },

    roleButton: {
      width: '100%',
      padding: '15px',
      marginBottom: '12px',
      borderRadius: '12px',
      border: '1px solid #ddd',
      background: '#fff',
      fontSize: '17px',
      cursor: 'pointer',
    },

    message: {
      marginTop: '15px',
      padding: '12px',
      background: '#f1f5f9',
      borderRadius: '10px',
      color: '#333',
      wordBreak: 'break-word',
    },

    code: {
      textAlign: 'center',
      fontSize: '32px',
      fontWeight: 'bold',
      letterSpacing: '5px',
      padding: '20px',
      background: '#eff6ff',
      borderRadius: '12px',
      color: '#1d4ed8',
      margin: '15px 0',
    },

    section: {
      marginTop: '25px',
      paddingTop: '20px',
      borderTop: '1px solid #eee',
    },

    childCard: {
      padding: '15px',
      marginBottom: '10px',
      borderRadius: '12px',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
    },
  }

  if (!role) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>FamilyTrack</h1>

          <p style={styles.subtitle}>
            Family safety and location tracking
          </p>

          <button
            style={styles.roleButton}
            onClick={() => setRole('parent')}
          >
            👨 Parent
          </button>

          <button
            style={styles.roleButton}
            onClick={() => setRole('child')}
          >
            👦 Child
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>FamilyTrack</h1>

          <p style={styles.subtitle}>
            {role === 'parent'
              ? 'Parent Login'
              : 'Child Login'}
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

          <button
            style={styles.button}
            onClick={handleEmailLogin}
            disabled={loading}
          >
            {loading ? 'Please wait...' : 'Login'}
          </button>

          <button
            style={styles.secondaryButton}
            onClick={handleSignup}
            disabled={loading}
          >
            Create Account
          </button>

          <button
            style={styles.secondaryButton}
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            Continue with Google
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => {
              setRole('')
              setMessage('')
            }}
          >
            Back
          </button>

          {message && (
            <div style={styles.message}>
              {message}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>FamilyTrack</h1>

        <p style={styles.subtitle}>
          Welcome {user.email}
        </p>

        {role === 'parent' ? (
          <>
            <h2>Parent Dashboard</h2>

            {!familyCode ? (
              <>
                <p>
                  Create a family and give the Family Code
                  to your children.
                </p>

                <button
                  style={styles.button}
                  onClick={handleCreateFamily}
                  disabled={loading}
                >
                  {loading ? 'Creating...' : 'Create Family'}
                </button>
              </>
            ) : (
              <>
                <p>Your Family Code:</p>

                <div style={styles.code}>
                  {familyCode}
                </div>

                <p>
                  Give this code to your child so they can
                  join your family.
                </p>

                <div style={styles.section}>
                  <h2>Children</h2>

                  {children.length === 0 ? (
                    <p>
                      No children have joined yet.
                    </p>
                  ) : (
                    children.map((child) => (
                      <div
                        key={child.id}
                        style={styles.childCard}
                      >
                        <strong>👦 Child</strong>

                        <div style={{ marginTop: '6px' }}>
                          {child.email}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <h2>Child Dashboard</h2>

            {!familyCode ? (
              <>
                <p>
                  Enter the Family Code given to you by
                  your parent.
                </p>

                <input
                  style={styles.input}
                  type="text"
                  maxLength="6"
                  placeholder="Family Code"
                  value={joinCode}
                  onChange={(e) =>
                    setJoinCode(e.target.value.toUpperCase())
                  }
                />

                <button
                  style={styles.button}
                  onClick={handleJoinFamily}
                  disabled={loading}
                >
                  {loading ? 'Joining...' : 'Join Family'}
                </button>
              </>
            ) : (
              <>
                <p>
                  You are connected to family:
                </p>

                <div style={styles.code}>
                  {familyCode}
                </div>

                <p>
                  Your account is now registered as a
                  child in this family.
                </p>
              </>
            )}
          </>
        )}

        {message && (
          <div style={styles.message}>
            {message}
          </div>
        )}

        <div style={styles.section}>
          <button
            style={styles.secondaryButton}
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
