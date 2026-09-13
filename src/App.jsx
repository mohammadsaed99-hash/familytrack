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
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore'

import {
  getMessaging,
  getToken,
  isSupported,
} from 'firebase/messaging'

import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Circle,
  useMapEvents,
} from 'react-leaflet'

import L from 'leaflet'

import { auth, db } from './firebase'

const VAPID_KEY =
  'BEYnLQTQeaIbsVU6q1V5jLvXDOurQNOovshiLAhFv82QfYYkY-bp3XOMIK3uFvW-nVhHXccuDnDGtf7alSEqFHw'

const SAFE_ZONE_RADIUS = 100
const NOTIFICATION_WORKER_URL =
  'https://familytrack-notifications.mohammad-saed99.workers.dev'

const defaultCenter = [31.9539, 35.9106]

const childIcon = new L.Icon({
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  iconRetinaUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function SafeZonePicker({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
      })
    },
  })

  return null
}

export default function App() {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [familyCode, setFamilyCode] = useState('')
  const [familyData, setFamilyData] = useState(null)
  const [children, setChildren] = useState([])

  const [joinCode, setJoinCode] = useState('')

  const [location, setLocation] = useState(null)
  const [tracking, setTracking] = useState(false)

  const [safeZone, setSafeZone] = useState(null)
  const [safeZoneStatus, setSafeZoneStatus] = useState('unknown')
  const [distanceFromSafeZone, setDistanceFromSafeZone] =
    useState(null)

  const [notificationPermission, setNotificationPermission] =
    useState(
      typeof Notification !== 'undefined'
        ? Notification.permission
        : 'default'
    )

  const [fcmReady, setFcmReady] = useState(false)

  const watchIdRef = useRef(null)
  const previousChildStatusRef = useRef({})

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        setUser(currentUser)
        setLoading(false)

        if (!currentUser) {
          setRole(null)
          setFamilyCode('')
          setFamilyData(null)
          setChildren([])
          return
        }

        await findUserFamily(currentUser)
      }
    )

    return () => unsubscribe()
  }, [])

  async function findUserFamily(currentUser) {
    try {
      const familiesSnapshot = await getDocs(
        collection(db, 'families')
      )

      let foundFamily = null
      let foundRole = null

      for (const familyDoc of familiesSnapshot.docs) {
        const data = familyDoc.data()

        if (data.parentId === currentUser.uid) {
          foundFamily = {
            id: familyDoc.id,
            ...data,
          }

          foundRole = 'parent'
          break
        }

        const memberSnapshot = await getDocs(
          query(
            collection(
              db,
              'families',
              familyDoc.id,
              'members'
            ),
            where('__name__', '==', currentUser.uid)
          )
        )

        if (!memberSnapshot.empty) {
          const memberData =
            memberSnapshot.docs[0].data()

          foundFamily = {
            id: familyDoc.id,
            ...data,
            memberData,
          }

          foundRole = 'child'
          break
        }
      }

      if (foundFamily) {
        setFamilyCode(foundFamily.id)
        setFamilyData(foundFamily)
        setRole(foundRole)
      }
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (!familyCode || role !== 'parent') return

    const familyRef = doc(
      db,
      'families',
      familyCode
    )

    const unsubscribeFamily = onSnapshot(
      familyRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data()

          setFamilyData({
            id: snapshot.id,
            ...data,
          })

          setSafeZone(data.safeZone || null)
        }
      }
    )

    const membersRef = collection(
      db,
      'families',
      familyCode,
      'members'
    )

    const unsubscribeMembers = onSnapshot(
      membersRef,
      (snapshot) => {
        const list = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))

        setChildren(list)
      }
    )

    return () => {
      unsubscribeFamily()
      unsubscribeMembers()
    }
  }, [familyCode, role])

  useEffect(() => {
    if (
      !familyCode ||
      role !== 'child' ||
      !user
    ) {
      return
    }

    const memberRef = doc(
      db,
      'families',
      familyCode,
      'members',
      user.uid
    )

    const unsubscribe = onSnapshot(
      memberRef,
      (snapshot) => {
        if (!snapshot.exists()) return

        const data = snapshot.data()

        if (
          typeof data.latitude === 'number' &&
          typeof data.longitude === 'number'
        ) {
          setLocation({
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy,
          })

          setSafeZoneStatus(
            data.safeZoneStatus || 'unknown'
          )

          setDistanceFromSafeZone(
            typeof data.distanceFromSafeZone ===
              'number'
              ? data.distanceFromSafeZone
              : null
          )
        }
      }
    )

    return () => unsubscribe()
  }, [familyCode, role, user])

  useEffect(() => {
    if (!familyCode || role !== 'parent') return

    const unsubscribe = onSnapshot(
      collection(
        db,
        'families',
        familyCode,
        'members'
      ),
      (snapshot) => {
        snapshot.docs.forEach((item) => {
          const child = {
            id: item.id,
            ...item.data(),
          }

          const previousStatus =
            previousChildStatusRef.current[
              child.id
            ]

          if (
            child.safeZoneStatus === 'outside' &&
            previousStatus &&
            previousStatus !== 'outside'
          ) {
            sendParentNotification(child)
          }

          previousChildStatusRef.current[
            child.id
          ] =
            child.safeZoneStatus || 'unknown'
        })
      }
    )

    return () => unsubscribe()
  }, [familyCode, role])

  useEffect(() => {
    if (
      role === 'parent' &&
      notificationPermission === 'granted'
    ) {
      registerForPushNotifications()
    }
  }, [
    role,
    notificationPermission,
    familyCode,
    user,
  ])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(
          watchIdRef.current
        )
      }
    }
  }, [])

  async function register() {
    setError('')
    setMessage('')

    if (!email || !password) {
      setError(
        'Please enter email and password.'
      )
      return
    }

    try {
      const result =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        )

      setUser(result.user)

      setMessage(
        'Account created successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function login() {
    setError('')
    setMessage('')

    if (!email || !password) {
      setError(
        'Please enter email and password.'
      )
      return
    }

    try {
      const result =
        await signInWithEmailAndPassword(
          auth,
          email,
          password
        )

      setUser(result.user)

      setMessage(
        'Logged in successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function loginWithGoogle() {
    setError('')
    setMessage('')

    try {
      const provider =
        new GoogleAuthProvider()

      const result =
        await signInWithPopup(
          auth,
          provider
        )

      setUser(result.user)

      setMessage(
        'Logged in successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function createFamily() {
    if (!user) return

    setError('')
    setMessage('')

    try {
      const code = Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()

      await setDoc(
        doc(db, 'families', code),
        {
          parentId: user.uid,
          parentEmail: user.email || '',
          createdAt: serverTimestamp(),
        }
      )

      setFamilyCode(code)
      setRole('parent')

      setFamilyData({
        id: code,
        parentId: user.uid,
        parentEmail: user.email || '',
      })

      setMessage(
        'Family created successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function joinFamily() {
    if (!user || !joinCode) return

    setError('')
    setMessage('')

    try {
      const code =
        joinCode.trim().toUpperCase()

      const familySnapshot = await getDocs(
        query(
          collection(db, 'families'),
          where('__name__', '==', code)
        )
      )

      if (familySnapshot.empty) {
        setError('Family code not found.')
        return
      }

      const memberRef = doc(
        db,
        'families',
        code,
        'members',
        user.uid
      )

      await setDoc(memberRef, {
        userId: user.uid,
        email: user.email || '',
        role: 'child',
        joinedAt: serverTimestamp(),
      })

      const familyDataSnapshot =
        familySnapshot.docs[0].data()

      setFamilyCode(code)

      setFamilyData({
        id: code,
        ...familyDataSnapshot,
      })

      setRole('child')

      setMessage(
        'You joined the family successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  function startLocationTracking() {
    if (!navigator.geolocation) {
      setError(
        'Geolocation is not supported by this browser.'
      )
      return
    }

    if (!familyCode || !user) {
      setError(
        'You are not connected to a family.'
      )
      return
    }

    if (watchIdRef.current !== null) {
      return
    }

    setError('')
    setMessage(
      'Starting live location...'
    )

    let lastSent = 0

    watchIdRef.current =
      navigator.geolocation.watchPosition(
        async (position) => {
          const now = Date.now()

          if (now - lastSent < 30000) {
            return
          }

          lastSent = now

          const latitude =
            position.coords.latitude

          const longitude =
            position.coords.longitude

          const accuracy =
            position.coords.accuracy

          setLocation({
            latitude,
            longitude,
            accuracy,
          })

          let status = 'unknown'
          let distance = null

          if (
            safeZone &&
            typeof safeZone.latitude ===
              'number' &&
            typeof safeZone.longitude ===
              'number'
          ) {
            distance =
              calculateDistance(
                latitude,
                longitude,
                safeZone.latitude,
                safeZone.longitude
              )

            status =
              distance <= SAFE_ZONE_RADIUS
                ? 'inside'
                : 'outside'
          }

          setSafeZoneStatus(status)
          setDistanceFromSafeZone(distance)

          try {
            const memberRef = doc(
              db,
              'families',
              familyCode,
              'members',
              user.uid
            )

            await setDoc(
              memberRef,
              {
                userId: user.uid,
                email: user.email || '',
                role: 'child',
                latitude,
                longitude,
                accuracy,
                locationUpdatedAt:
                  serverTimestamp(),
                safeZoneStatus: status,
                distanceFromSafeZone:
                  distance,
              },
              { merge: true }
            )

            setMessage(
              'Live location updated.'
            )
          } catch (err) {
            setError(err.message)
          }
        },
        (err) => {
          setError(err.message)
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 20000,
        }
      )

    setTracking(true)
  }

  function stopLocationTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      )

      watchIdRef.current = null
    }

    setTracking(false)
    setMessage(
      'Live location stopped.'
    )
  }

  async function setSafeZoneAtLocation(
    position
  ) {
    if (
      !familyCode ||
      role !== 'parent'
    ) {
      return
    }

    try {
      const newSafeZone = {
        latitude: position.latitude,
        longitude: position.longitude,
        radius: SAFE_ZONE_RADIUS,
        updatedAt: serverTimestamp(),
      }

      await updateDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          safeZone: newSafeZone,
        }
      )

      setSafeZone({
        latitude: position.latitude,
        longitude: position.longitude,
        radius: SAFE_ZONE_RADIUS,
      })

      setMessage(
        'Safe Zone saved successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function requestNotificationPermission() {
    if (
      typeof Notification ===
      'undefined'
    ) {
      setError(
        'Notifications are not supported by this browser.'
      )
      return
    }

    try {
      const permission =
        await Notification.requestPermission()

      setNotificationPermission(
        permission
      )

      if (permission === 'granted') {
        await registerForPushNotifications()

        setMessage(
          'Notifications enabled.'
        )
      } else if (
        permission === 'denied'
      ) {
        setError(
          'Notification permission was blocked.'
        )
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function registerForPushNotifications() {
    try {
      if (
        typeof Notification ===
        'undefined'
      ) {
        return
      }

      if (
        Notification.permission !==
        'granted'
      ) {
        return
      }

      if (
        !user ||
        !familyCode ||
        role !== 'parent'
      ) {
        return
      }

      const supported =
        await isSupported()

      if (!supported) {
        console.log(
          'Firebase Messaging is not supported.'
        )
        return
      }

      const messagingInstance =
        getMessaging()

      const registration =
        await navigator.serviceWorker.register(
          '/familytrack/firebase-messaging-sw.js'
        )

      const token = await getToken(
        messagingInstance,
        {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration:
            registration,
        }
      )

      if (!token) {
        console.log(
          'No FCM registration token available.'
        )
        return
      }

      localStorage.setItem(
        'familytrack_fcm_token',
        token
      )

      await setDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          parentFcmToken: token,
          parentFcmTokenUpdatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      )

      setFcmReady(true)

      setMessage(
        'Push notifications are ready on this device.'
      )

      console.log(
        'FCM token saved to Firestore:',
        token
      )
    } catch (err) {
      console.error(
        'FCM registration error:',
        err
      )

      setFcmReady(false)
    }
  }

  function sendParentNotification(child) {
    if (
      typeof Notification ===
        'undefined' ||
      Notification.permission !==
        'granted'
    ) {
      return
    }

    const name =
      child.email ||
      'Your child'

    new Notification(
      'FamilyTrack Alert',
      {
        body: `${name} has left the Safe Zone.`,
      }
    )
  }

  async function logout() {
    stopLocationTracking()

    await signOut(auth)

    setUser(null)
    setRole(null)
    setFamilyCode('')
    setFamilyData(null)
    setChildren([])
    setLocation(null)
    setSafeZone(null)
    setFcmReady(false)
  }

  if (loading) {
    return (
      <div style={styles.centerScreen}>
        <h2>FamilyTrack</h2>
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={styles.page}>
        <div style={styles.authCard}>
          <h1 style={styles.logo}>
            🏠 FamilyTrack
          </h1>

          <p style={styles.subtitle}>
            Family safety and location tracking
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
            style={styles.primaryButton}
            onClick={login}
          >
            Login
          </button>

          <button
            style={styles.secondaryButton}
            onClick={register}
          >
            Create Account
          </button>

          <div style={styles.divider}>
            OR
          </div>

          <button
            style={styles.googleButton}
            onClick={loginWithGoogle}
          >
            Continue with Google
          </button>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          {message && (
            <div style={styles.successBox}>
              {message}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!role) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1>🏠 FamilyTrack</h1>

          <p>
            Logged in as:
            <br />
            <strong>
              {user.email}
            </strong>
          </p>

          <h2>Choose your role</h2>

          <button
            style={styles.primaryButton}
            onClick={createFamily}
          >
            👨‍👩‍👧 Create Family
          </button>

          <div style={styles.divider}>
            OR
          </div>

          <input
            style={styles.input}
            placeholder="Enter Family Code"
            value={joinCode}
            onChange={(e) =>
              setJoinCode(e.target.value)
            }
          />

          <button
            style={styles.secondaryButton}
            onClick={joinFamily}
          >
            👦 Join Family
          </button>

          <button
            style={styles.logoutButton}
            onClick={logout}
          >
            Logout
          </button>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          {message && (
            <div style={styles.successBox}>
              {message}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (role === 'child') {
    return (
      <div style={styles.page}>
        <div style={styles.dashboard}>
          <Header
            email={user.email}
            onLogout={logout}
          />

          <h2>
            👦 Child Dashboard
          </h2>

          <div style={styles.infoCard}>
            <strong>
              Family Code
            </strong>

            <div style={styles.code}>
              {familyCode}
            </div>
          </div>

          <div style={styles.infoCard}>
            <strong>
              Location Sharing
            </strong>

            <p>
              {tracking
                ? '🟢 Live location is active'
                : '⚪ Location sharing is stopped'}
            </p>

            {!tracking ? (
              <button
                style={
                  styles.primaryButton
                }
                onClick={
                  startLocationTracking
                }
              >
                📍 Start Live Location
              </button>
            ) : (
              <button
                style={
                  styles.dangerButton
                }
                onClick={
                  stopLocationTracking
                }
              >
                Stop Live Location
              </button>
            )}
          </div>

          <div style={styles.infoCard}>
            <strong>
              Safe Zone
            </strong>

            {safeZoneStatus ===
              'inside' && (
              <p
                style={
                  styles.insideText
                }
              >
                🟢 You are inside the Safe Zone.
              </p>
            )}

            {safeZoneStatus ===
              'outside' && (
              <p
                style={
                  styles.outsideText
                }
              >
                🔴 You are outside the Safe Zone.
              </p>
            )}

            {distanceFromSafeZone !==
              null && (
              <p>
                Distance from Safe Zone:{' '}
                {Math.round(
                  distanceFromSafeZone
                )}{' '}
                meters
              </p>
            )}
          </div>

          {location && (
            <div style={styles.infoCard}>
              <strong>
                Current Location
              </strong>

              <p>
                Latitude:{' '}
                {location.latitude.toFixed(
                  6
                )}
              </p>

              <p>
                Longitude:{' '}
                {location.longitude.toFixed(
                  6
                )}
              </p>

              <p>
                Accuracy:{' '}
                {Math.round(
                  location.accuracy || 0
                )}{' '}
                meters
              </p>
          </div>
          )}

          {message && (
            <div style={styles.successBox}>
              {message}
            </div>
          )}

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.dashboard}>
        <Header
          email={user.email}
          onLogout={logout}
        />

        <h2>
          👨‍👩‍👧 Parent Dashboard
        </h2>

        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <strong>
              {children.length}
            </strong>

            <span>Children</span>
          </div>

          <div style={styles.statCard}>
            <strong>
              {
                children.filter(
                  (child) =>
                    typeof child.latitude ===
                    'number'
                ).length
              }
            </strong>

            <span>
              Locations shared
            </span>
          </div>
        </div>

        <div style={styles.infoCard}>
          <h3>
            Your Family Code
          </h3>

          <div style={styles.familyCode}>
            {familyCode}
          </div>

          <p>
            Give this code to your children.
          </p>
        </div>

        <div style={styles.infoCard}>
          <h3>
            🔔 Parent Alerts
          </h3>

          {notificationPermission ===
          'denied' ? (
            <p
              style={
                styles.outsideText
              }
            >
              🔴 Browser notifications are blocked.
            </p>
          ) : fcmReady ? (
            <p
              style={
                styles.insideText
              }
            >
              🟢 Push notifications are ready on this
              device.
            </p>
          ) : notificationPermission ===
            'granted' ? (
            <>
              <p
                style={
                  styles.insideText
                }
              >
                🟢 Browser notifications are enabled.
              </p>

              <button
                style={
                  styles.secondaryButton
                }
                onClick={
                  registerForPushNotifications
                }
              >
                Activate Push Notifications
              </button>
            </>
          ) : (
            <>
              <p>
                Enable notifications to receive Safe
                Zone alerts.
              </p>

              <button
                style={
                  styles.primaryButton
                }
                onClick={
                  requestNotificationPermission
                }
              >
                🔔 Enable Notifications
              </button>
            </>
          )}
        </div>

        <div style={styles.infoCard}>
          <h3>
            🟢 Safe Zone
          </h3>

          {safeZone ? (
            <>
              <p>
                Safe Zone is active.
              </p>

              <p>
                Radius:{' '}
                {SAFE_ZONE_RADIUS} meters
              </p>

              <MapContainer
                center={[
                  safeZone.latitude,
                  safeZone.longitude,
                ]}
                zoom={16}
                scrollWheelZoom={true}
              >
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <Circle
                  center={[
                    safeZone.latitude,
                    safeZone.longitude,
                  ]}
                  radius={
                    SAFE_ZONE_RADIUS
                  }
                />

                <SafeZonePicker
                  onPick={
                    setSafeZoneAtLocation
                  }
                />

                {children.map(
                  (child) =>
                    typeof child.latitude ===
                      'number' &&
                    typeof child.longitude ===
                      'number' && (
                      <Marker
                        key={child.id}
                        position={[
                          child.latitude,
                          child.longitude,
                        ]}
                        icon={childIcon}
                      >
                        <Popup>
                          <strong>
                            {child.email ||
                              'Child'}
                          </strong>

                          <br />

                          Accuracy:{' '}
                          {Math.round(
                            child.accuracy ||
                              0
                          )}{' '}
                          meters

                          <br />

                          {child.safeZoneStatus ===
                          'outside'
                            ? '🔴 Outside Safe Zone'
                            : '🟢 Inside Safe Zone'}
                        </Popup>
                      </Marker>
                    )
                )}
              </MapContainer>

              <p
                style={
                  styles.mapHint
                }
              >
                Click anywhere on the map to move the
                Safe Zone.
              </p>
            </>
          ) : (
            <>
              <p>
                Safe Zone is not configured.
              </p>

              <p>
                Click on the map below to create a
                100-meter Safe Zone.
              </p>

              <MapContainer
                center={defaultCenter}
                zoom={12}
                scrollWheelZoom={true}
              >
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <SafeZonePicker
                  onPick={
                    setSafeZoneAtLocation
                  }
                />
              </MapContainer>
            </>
          )}
        </div>

        <div style={styles.infoCard}>
          <h3>
            👨‍👩‍👧 Children
          </h3>

          {children.length === 0 ? (
            <p>
              No children have joined yet.
            </p>
          ) : (
            children.map((child) => (
              <div
                key={child.id}
                style={
                  styles.childCard
                }
              >
                <strong>
                  {child.email ||
                    'Child'}
                </strong>

                <p>
                  {typeof child.latitude ===
                  'number'
                    ? '📍 Location available'
                    : '⚪ No location yet'}
                </p>

                {child.safeZoneStatus ===
                  'outside' && (
                  <p
                    style={
                      styles.outsideText
                    }
                  >
                    🔴 Child is outside the Safe Zone
                  </p>
                )}

                {child.safeZoneStatus ===
                  'inside' && (
                  <p
                    style={
                      styles.insideText
                    }
                  >
                    🟢 Child is inside the Safe Zone
                  </p>
                )}

                {typeof child.distanceFromSafeZone ===
                  'number' && (
                  <p>
                    Distance:{' '}
                    {Math.round(
                      child.distanceFromSafeZone
                    )}{' '}
                    meters
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {message && (
          <div style={styles.successBox}>
            {message}
          </div>
        )}

        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function Header({
  email,
  onLogout,
}) {
  return (
    <div style={styles.header}>
      <div>
        <h1
          style={{
            margin: 0,
          }}
        >
          🏠 FamilyTrack
        </h1>

        <small>{email}</small>
      </div>

      <button
        style={
          styles.logoutButton
        }
        onClick={onLogout}
      >
        Logout
      </button>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    padding: '20px',
    background: '#f1f5f9',
  },

  centerScreen: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f1f5f9',
  },

  authCard: {
    maxWidth: '420px',
    margin: '50px auto',
    padding: '30px',
    background: '#ffffff',
    borderRadius: '20px',
    boxShadow:
      '0 10px 30px rgba(0,0,0,0.08)',
  },

  card: {
    maxWidth: '500px',
    margin: '50px auto',
    padding: '30px',
    background: '#ffffff',
    borderRadius: '20px',
    boxShadow:
      '0 10px 30px rgba(0,0,0,0.08)',
  },

  dashboard: {
    maxWidth: '1000px',
    margin: '0 auto',
  },

  logo: {
    textAlign: 'center',
  },

  subtitle: {
    textAlign: 'center',
    color: '#64748b',
    marginBottom: '25px',
  },

  input: {
    width: '100%',
    padding: '13px',
    marginBottom: '12px',
    border:
      '1px solid #cbd5e1',
    borderRadius: '10px',
    fontSize: '16px',
  },

  primaryButton: {
    width: '100%',
    padding: '13px',
    border: 'none',
    borderRadius: '10px',
    background: '#2563eb',
    color: '#fff',
    fontSize: '16px',
    cursor: 'pointer',
    marginBottom: '10px',
  },

  secondaryButton: {
    width: '100%',
    padding: '13px',
    border: 'none',
    borderRadius: '10px',
    background: '#0f766e',
    color: '#fff',
    fontSize: '16px',
    cursor: 'pointer',
    marginBottom: '10px',
  },

  dangerButton: {
    width: '100%',
    padding: '13px',
    border: 'none',
    borderRadius: '10px',
    background: '#dc2626',
    color: '#fff',
    fontSize: '16px',
    cursor: 'pointer',
  },

  googleButton: {
    width: '100%',
    padding: '13px',
    border:
      '1px solid #cbd5e1',
    borderRadius: '10px',
    background: '#fff',
    color: '#111827',
    fontSize: '16px',
    cursor: 'pointer',
  },

  logoutButton: {
    padding: '9px 14px',
    border: 'none',
    borderRadius: '8px',
    background: '#475569',
    color: '#fff',
    cursor: 'pointer',
  },

  divider: {
    textAlign: 'center',
    margin: '18px 0',
    color: '#94a3b8',
  },

  errorBox: {
    marginTop: '15px',
    padding: '12px',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '10px',
  },

  successBox: {
    marginTop: '15px',
    padding: '12px',
    background: '#dcfce7',
    color: '#166534',
    borderRadius: '10px',
  },

  header: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    gap: '15px',
    marginBottom: '25px',
    background: '#fff',
    padding: '18px',
    borderRadius: '16px',
  },

  statsGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '15px',
    marginBottom: '15px',
  },

  statCard: {
    background: '#fff',
    padding: '20px',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },

  infoCard: {
    background: '#fff',
    padding: '20px',
    borderRadius: '16px',
    marginBottom: '15px',
    boxShadow:
      '0 3px 12px rgba(0,0,0,0.04)',
  },

  familyCode: {
    fontSize: '32px',
    fontWeight: 'bold',
    letterSpacing: '5px',
    padding: '15px',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '12px',
    textAlign: 'center',
    margin: '12px 0',
  },

  code: {
    fontSize: '24px',
    fontWeight: 'bold',
    letterSpacing: '3px',
    marginTop: '8px',
  },

  childCard: {
    padding: '15px',
    marginTop: '10px',
    border:
      '1px solid #e2e8f0',
    borderRadius: '12px',
  },

  insideText: {
    color: '#15803d',
    fontWeight: 'bold',
  },

  outsideText: {
    color: '#dc2626',
    fontWeight: 'bold',
  },

  mapHint: {
    color: '#64748b',
    fontSize: '14px',
  },
}
