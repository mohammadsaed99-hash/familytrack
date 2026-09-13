import { useEffect, useRef, useState } from 'react'

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

import 'leaflet/dist/leaflet.css'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
} from 'react-leaflet'

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
  const [loadingFamily, setLoadingFamily] = useState(false)

  const [isTracking, setIsTracking] = useState(false)

  const watchIdRef = useRef(null)
  const lastSavedRef = useRef(0)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(
          watchIdRef.current
        )
      }
    }
  }, [])

  useEffect(() => {
    if (!user || !role) return

    const findFamily = async () => {
      try {
        setLoadingFamily(true)
        setMessage('')

        const familiesRef = collection(db, 'families')
        const snapshot = await getDocs(familiesRef)

        if (role === 'parent') {
          const family = snapshot.docs.find(
            (familyDoc) =>
              familyDoc.data().parentId === user.uid
          )

          if (family) {
            setFamilyCode(family.id)
          }
        }

        if (role === 'child') {
          for (const familyDoc of snapshot.docs) {
            const memberRef = doc(
              db,
              'families',
              familyDoc.id,
              'members',
              user.uid
            )

            const memberSnapshot = await getDoc(memberRef)

            if (memberSnapshot.exists()) {
              setFamilyCode(familyDoc.id)
              break
            }
          }
        }
      } catch (error) {
        setMessage(error.message)
      } finally {
        setLoadingFamily(false)
      }
    }

    findFamily()
  }, [user, role])

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
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      )
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

      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      )

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

      await setDoc(
        doc(db, 'families', code),
        {
          familyCode: code,
          parentId: user.uid,
          parentEmail: user.email,
          createdAt: serverTimestamp(),
        }
      )

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
        doc(
          db,
          'families',
          code,
          'members',
          user.uid
        ),
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

  const saveLocation = async (position) => {
    if (!user || !familyCode) return

    const now = Date.now()

    if (
      lastSavedRef.current !== 0 &&
      now - lastSavedRef.current < 30000
    ) {
      return
    }

    try {
      const {
        latitude,
        longitude,
        accuracy,
      } = position.coords

      await setDoc(
        doc(
          db,
          'families',
          familyCode,
          'members',
          user.uid
        ),
        {
          userId: user.uid,
          email: user.email,
          role: 'child',
          latitude,
          longitude,
          accuracy,
          locationUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      )

      lastSavedRef.current = now
      setMessage('Location updated successfully!')
    } catch (error) {
      setMessage(error.message)
    }
  }

  const handleStartTracking = () => {
    setMessage('')

    if (!user) {
      setMessage('Please login first.')
      return
    }

    if (!familyCode) {
      setMessage('You are not connected to a family.')
      return
    }

    if (!navigator.geolocation) {
      setMessage(
        'Location is not supported by this browser.'
      )
      return
    }

    if (isTracking) return

    setLoading(true)

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await saveLocation(position)

          const watchId =
            navigator.geolocation.watchPosition(
              async (newPosition) => {
                await saveLocation(newPosition)
              },
              (error) => {
                if (error.code === 1) {
                  setMessage(
                    'Location permission was denied.'
                  )
                } else if (error.code === 2) {
                  setMessage(
                    'Location is unavailable.'
                  )
                } else {
                  setMessage(
                    'Unable to update location.'
                  )
                }
              },
              {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 10000,
              }
            )

          watchIdRef.current = watchId
          setIsTracking(true)
          setMessage(
            'Live location tracking started!'
          )
        } catch (error) {
          setMessage(error.message)
        } finally {
          setLoading(false)
        }
      },
      (error) => {
        setLoading(false)

        if (error.code === 1) {
          setMessage(
            'Location permission was denied.'
          )
        } else if (error.code === 2) {
          setMessage(
            'Location is unavailable.'
          )
        } else {
          setMessage(
            'Unable to get your location.'
          )
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }

  const handleStopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      )

      watchIdRef.current = null
    }

    setIsTracking(false)
    setMessage(
      'Live location tracking stopped.'
    )
  }

  const handleLogout = async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      )

      watchIdRef.current = null
    }

    setIsTracking(false)

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
      padding: '25px 15px',
      background:
        'linear-gradient(180deg, #eff6ff 0%, #f8fafc 45%, #f1f5f9 100%)',
      fontFamily: 'Arial, sans-serif',
    },

    container: {
      width: '100%',
      maxWidth: '1000px',
      margin: '0 auto',
    },

    card: {
      background: '#ffffff',
      borderRadius: '24px',
      padding: '24px',
      boxShadow:
        '0 12px 35px rgba(15,23,42,0.08)',
      border: '1px solid #e2e8f0',
    },

    authCard: {
      maxWidth: '500px',
      margin: '70px auto',
    },

    logo: {
      textAlign: 'center',
      fontSize: '32px',
      fontWeight: '800',
      color: '#2563eb',
      marginBottom: '6px',
    },

    subtitle: {
      textAlign: 'center',
      color: '#64748b',
      marginTop: 0,
      marginBottom: '28px',
    },

    input: {
      width: '100%',
      padding: '14px',
      marginBottom: '12px',
      borderRadius: '12px',
      border: '1px solid #cbd5e1',
      fontSize: '16px',
      outline: 'none',
    },

    button: {
      width: '100%',
      padding: '14px',
      marginBottom: '10px',
      borderRadius: '12px',
      border: 'none',
      background: '#2563eb',
      color: '#fff',
      fontSize: '16px',
      fontWeight: 'bold',
      cursor: 'pointer',
    },

    secondaryButton: {
      width: '100%',
      padding: '14px',
      marginBottom: '10px',
      borderRadius: '12px',
      border: '1px solid #cbd5e1',
      background: '#fff',
      color: '#0f172a',
      fontSize: '16px',
      cursor: 'pointer',
    },

    stopButton: {
      width: '100%',
      padding: '14px',
      marginBottom: '10px',
      borderRadius: '12px',
      border: 'none',
      background: '#dc2626',
      color: '#fff',
      fontSize: '16px',
      fontWeight: 'bold',
      cursor: 'pointer',
    },

    roleButton: {
      width: '100%',
      padding: '18px',
      marginBottom: '12px',
      borderRadius: '16px',
      border: '1px solid #dbeafe',
      background: '#f8fbff',
      fontSize: '18px',
      fontWeight: 'bold',
      cursor: 'pointer',
      color: '#1e3a8a',
    },

    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '15px',
      marginBottom: '24px',
      flexWrap: 'wrap',
    },

    headerTitle: {
      margin: 0,
      fontSize: '28px',
    },

    userText: {
      margin: '5px 0 0',
      color: '#64748b',
      fontSize: '14px',
    },

    logoutButton: {
      padding: '10px 18px',
      borderRadius: '10px',
      border: '1px solid #fecaca',
      background: '#fff',
      color: '#dc2626',
      cursor: 'pointer',
      fontWeight: 'bold',
    },

    statGrid: {
      display: 'grid',
      gridTemplateColumns:
        'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '14px',
      marginBottom: '22px',
    },

    stat: {
      padding: '18px',
      borderRadius: '16px',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
    },

    statNumber: {
      fontSize: '28px',
      fontWeight: '800',
      color: '#2563eb',
    },

    statLabel: {
      color: '#64748b',
      marginTop: '5px',
    },

    familyBox: {
      padding: '20px',
      borderRadius: '18px',
      background:
        'linear-gradient(135deg, #eff6ff, #dbeafe)',
      marginBottom: '22px',
      textAlign: 'center',
    },

    code: {
      fontSize: '34px',
      fontWeight: '800',
      letterSpacing: '6px',
      color: '#1d4ed8',
      margin: '12px 0',
    },

    sectionTitle: {
      margin: '0 0 15px',
      fontSize: '21px',
    },

    childCard: {
      marginBottom: '18px',
      padding: '18px',
      borderRadius: '18px',
      background: '#fff',
      border: '1px solid #e2e8f0',
      boxShadow:
        '0 5px 18px rgba(15,23,42,0.05)',
    },

    childHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '14px',
    },

    avatar: {
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      background: '#dbeafe',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '25px',
    },

    status: {
      display: 'inline-block',
      padding: '5px 10px',
      borderRadius: '20px',
      background: '#dcfce7',
      color: '#166534',
      fontSize: '12px',
      fontWeight: 'bold',
      marginTop: '4px',
    },

    noLocation: {
      padding: '15px',
      borderRadius: '12px',
      background: '#f8fafc',
      color: '#64748b',
      textAlign: 'center',
    },

    trackingBox: {
      padding: '22px',
      borderRadius: '18px',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      textAlign: 'center',
      marginTop: '20px',
    },

    active: {
      padding: '14px',
      borderRadius: '12px',
      background: '#dcfce7',
      color: '#166534',
      fontWeight: 'bold',
      marginBottom: '12px',
    },

    message: {
      marginTop: '18px',
      padding: '13px',
      background: '#f1f5f9',
      borderRadius: '12px',
      color: '#334155',
      wordBreak: 'break-word',
      textAlign: 'center',
    },

    divider: {
      height: '1px',
      background: '#e2e8f0',
      margin: '24px 0',
    },
  }

  if (!role) {
    return (
      <div style={styles.page}>
        <div
          style={{
            ...styles.card,
            ...styles.authCard,
          }}
        >
          <div style={styles.logo}>
            🏠 FamilyTrack
          </div>

          <p style={styles.subtitle}>
            Family safety made simple
          </p>

          <button
            style={styles.roleButton}
            onClick={() => setRole('parent')}
          >
            👨‍👩‍👧 Parent
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
        <div
          style={{
            ...styles.card,
            ...styles.authCard,
          }}
        >
          <div style={styles.logo}>
            🏠 FamilyTrack
          </div>

          <p style={styles.subtitle}>
            {role === 'parent'
              ? 'Parent Account'
              : 'Child Account'}
          </p>

          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
          />

          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
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

  if (loadingFamily) {
    return (
      <div style={styles.page}>
        <div
          style={{
            ...styles.card,
            maxWidth: '600px',
            margin: '70px auto',
            textAlign: 'center',
          }}
        >
          <div style={styles.logo}>
            🏠 FamilyTrack
          </div>

          <p style={styles.subtitle}>
            Loading your family...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.header}>
            <div>
              <h1 style={styles.headerTitle}>
                🏠 FamilyTrack
              </h1>

              <p style={styles.userText}>
                {user.email}
              </p>
            </div>

            <button
              style={styles.logoutButton}
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>

          {role === 'parent' ? (
            <>
              <h2 style={styles.sectionTitle}>
                Parent Dashboard
              </h2>

              {!familyCode ? (
                <div style={styles.trackingBox}>
                  <div
                    style={{
                      fontSize: '45px',
                      marginBottom: '10px',
                    }}
                  >
                    👨‍👩‍👧‍👦
                  </div>

                  <h3>
                    Create your family
                  </h3>

                  <p
                    style={{
                      color: '#64748b',
                    }}
                  >
                    Create a family and invite your
                    children with a simple code.
                  </p>

                  <button
                    style={styles.button}
                    onClick={handleCreateFamily}
                    disabled={loading}
                  >
                    {loading
                      ? 'Creating...'
                      : 'Create Family'}
                  </button>
                </div>
              ) : (
                <>
                  <div style={styles.statGrid}>
                    <div style={styles.stat}>
                      <div style={styles.statNumber}>
                        {children.length}
                      </div>

                      <div style={styles.statLabel}>
                        Children
                      </div>
                    </div>

                    <div style={styles.stat}>
                      <div style={styles.statNumber}>
                        {
                          children.filter(
                            (child) =>
                              child.latitude &&
                              child.longitude
                          ).length
                        }
                      </div>

                      <div style={styles.statLabel}>
                        Locations shared
                      </div>
                    </div>
                  </div>

                  <div style={styles.familyBox}>
                    <div
                      style={{
                        color: '#475569',
                      }}
                    >
                      Your Family Code
                    </div>

                    <div style={styles.code}>
                      {familyCode}
                    </div>

                    <div
                      style={{
                        color: '#475569',
                        fontSize: '14px',
                      }}
                    >
                      Give this code to your children
                    </div>
                  </div>

                  <h2 style={styles.sectionTitle}>
                    👨‍👩‍👧‍👦 Family Members
                  </h2>

                  {children.length === 0 ? (
                    <div style={styles.noLocation}>
                      No children have joined yet.
                    </div>
                  ) : (
                    children.map((child) => (
                      <div
                        key={child.id}
                        style={styles.childCard}
                      >
                        <div
                          style={styles.childHeader}
                        >
                          <div style={styles.avatar}>
                            👦
                          </div>

                          <div>
                            <strong>
                              Child
                            </strong>

                            <div
                              style={{
                                color: '#64748b',
                                fontSize: '14px',
                                marginTop: '3px',
                              }}
                            >
                              {child.email}
                            </div>

                            {child.latitude &&
                            child.longitude ? (
                              <div
                                style={styles.status}
                              >
                                🟢 Location available
                              </div>
                            ) : (
                              <div
                                style={{
                                  ...styles.status,
                                  background:
                                    '#f1f5f9',
                                  color: '#64748b',
                                }}
                              >
                                ⚪ No location
                              </div>
                            )}
                          </div>
                        </div>

                        {child.latitude &&
                        child.longitude ? (
                          <>
                            <MapContainer
                              center={[
                                child.latitude,
                                child.longitude,
                              ]}
                              zoom={15}
                              scrollWheelZoom={true}
                            >
                              <TileLayer
                                attribution="&copy; OpenStreetMap contributors"
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                              />

                              <Marker
                                position={[
                                  child.latitude,
                                  child.longitude,
                                ]}
                              >
                                <Popup>
                                  👦 Child location
                                  <br />
                                  Accuracy:{' '}
                                  {Math.round(
                                    child.accuracy || 0
                                  )}{' '}
                                  meters
                                </Popup>
                              </Marker>
                            </MapContainer>

                            <div
                              style={{
                                marginTop: '10px',
                                color: '#64748b',
                                fontSize: '13px',
                              }}
                            >
                              📍 Accuracy:{' '}
                              {Math.round(
                                child.accuracy || 0
                              )}{' '}
                              meters
                            </div>
                          </>
                        ) : (
                          <div
                            style={styles.noLocation}
                          >
                            📍 Waiting for location
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <h2 style={styles.sectionTitle}>
                Child Dashboard
              </h2>

              {!familyCode ? (
                <div style={styles.trackingBox}>
                  <div
                    style={{
                      fontSize: '45px',
                      marginBottom: '10px',
                    }}
                  >
                    👨‍👩‍👧‍👦
                  </div>

                  <h3>
                    Join your family
                  </h3>

                  <p
                    style={{
                      color: '#64748b',
                    }}
                  >
                    Enter the Family Code from your
                    parent.
                  </p>

                  <input
                    style={styles.input}
                    type="text"
                    maxLength="6"
                    placeholder="Family Code"
                    value={joinCode}
                    onChange={(e) =>
                      setJoinCode(
                        e.target.value.toUpperCase()
                      )
                    }
                  />

                  <button
                    style={styles.button}
                    onClick={handleJoinFamily}
                    disabled={loading}
                  >
                    {loading
                      ? 'Joining...'
                      : 'Join Family'}
                  </button>
                </div>
              ) : (
                <>
                  <div style={styles.familyBox}>
                    <div
                      style={{
                        color: '#475569',
                      }}
                    >
                      Connected to family
                    </div>

                    <div style={styles.code}>
                      {familyCode}
                    </div>
                  </div>

                  <div style={styles.trackingBox}>
                    {isTracking ? (
                      <>
                        <div style={styles.active}>
                          🟢 Live location is active
                        </div>

                        <p
                          style={{
                            color: '#64748b',
                          }}
                        >
                          Your location is being
                          shared with your parent.
                        </p>

                        <button
                          style={styles.stopButton}
                          onClick={
                            handleStopTracking
                          }
                        >
                          🛑 Stop Location Sharing
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: '50px',
                            marginBottom: '10px',
                          }}
                        >
                          📍
                        </div>

                        <h3>
                          Share your location
                        </h3>

                        <p
                          style={{
                            color: '#64748b',
                          }}
                        >
                          Allow your parent to see
                          your current location.
                        </p>

                        <button
                          style={styles.button}
                          onClick={
                            handleStartTracking
                          }
                          disabled={loading}
                        >
                          {loading
                            ? 'Starting...'
                            : '📍 Start Live Location'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {message && (
            <div style={styles.message}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
