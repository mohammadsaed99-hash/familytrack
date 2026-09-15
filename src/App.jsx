import { useEffect, useMemo, useRef, useState } from 'react'

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
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  addDoc,
  serverTimestamp,
  limit,
  orderBy,
} from 'firebase/firestore'

import { getMessaging, getToken, isSupported } from 'firebase/messaging'

import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMapEvents,
} from 'react-leaflet'

import L from 'leaflet'
import { auth, db } from './firebase'

const VAPID_KEY =
  'BEYnLQTQeaIbsVU6q1V5jLvXDOurQNOovshiLAhFv82QfYYkY-bp3XOMIK3uFvW-nVhHXccuDnDGtf7alSEqFHw'

const NOTIFICATION_WORKER_URL =
  'https://familytrack-notifications.mohammad-saed99.workers.dev'

const DEFAULT_RADIUS = 100
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

function distanceMeters(lat1, lon1, lat2, lon2) {
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

function normalizeSafeZones(data) {
  if (Array.isArray(data?.safeZones)) {
    return data.safeZones
      .filter(
        (z) =>
          z &&
          typeof z.latitude === 'number' &&
          typeof z.longitude === 'number'
      )
      .map((z, i) => ({
        id: z.id || `zone-${i + 1}`,
        name: z.name || `Safe Zone ${i + 1}`,
        latitude: z.latitude,
        longitude: z.longitude,
        radius:
          typeof z.radius === 'number' ? z.radius : DEFAULT_RADIUS,
      }))
  }

  if (
    data?.safeZone &&
    typeof data.safeZone.latitude === 'number' &&
    typeof data.safeZone.longitude === 'number'
  ) {
    return [
      {
        id: 'legacy-safe-zone',
        name: 'Safe Zone 1',
        latitude: data.safeZone.latitude,
        longitude: data.safeZone.longitude,
        radius: data.safeZone.radius || DEFAULT_RADIUS,
      },
    ]
  }

  return []
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function formatDate(value) {
  if (!value) return '—'

  const date = value?.toDate ? value.toDate() : new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString()
}

function formatDistance(meters) {
  if (meters == null) return '—'

  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }

  return `${(meters / 1000).toFixed(1)} km`
}

function MapPicker({ onPick }) {
  useMapEvents({
    click: (e) =>
      onPick({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
      }),
  })

  return null
}

function Header({ email, onLogout }) {
  return (
    <div style={styles.header}>
      <div>
        <strong>🏠 FamilyTrack</strong>
        <div style={styles.muted}>{email}</div>
      </div>

      <button style={styles.smallButton} onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}

function Card({ title, children, action }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <h3>{title}</h3>
        {action}
      </div>

      {children}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)

  const [familyCode, setFamilyCode] = useState('')
  const [familyData, setFamilyData] = useState(null)
  const [children, setChildren] = useState([])

  const [loading, setLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [joinCode, setJoinCode] = useState('')

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [safeZones, setSafeZones] = useState([])
  const [places, setPlaces] = useState([])

  const [location, setLocation] = useState(null)
  const [tracking, setTracking] = useState(false)

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

  const [alerts, setAlerts] = useState([])
  const [events, setEvents] = useState([])
  const [checkIns, setCheckIns] = useState([])

  const [selectedChildId, setSelectedChildId] = useState('')

  const [zoneName, setZoneName] = useState('')
  const [zoneRadius, setZoneRadius] =
    useState(DEFAULT_RADIUS)

  const [placeName, setPlaceName] = useState('')
  const [placeRadius, setPlaceRadius] = useState(150)
  const [placeType, setPlaceType] = useState('Home')

  const [pendingPlace, setPendingPlace] = useState(null)
  const [mapPickMode, setMapPickMode] = useState('zone')

  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState([])

  const [sosCountdown, setSosCountdown] = useState(null)

  const [online, setOnline] = useState(navigator.onLine)

  const watchIdRef = useRef(null)
  const lastLocationSentRef = useRef(0)

  const previousStatusRef = useRef({})
  const previousPlaceStateRef = useRef({})

  const sosTimerRef = useRef(null)

  const currentChild = useMemo(
    () =>
      children.find((c) => c.id === selectedChildId) ||
      children[0],
    [children, selectedChildId]
  )

  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      async (currentUser) => {
        setUser(currentUser)
        setLoading(false)

        if (currentUser) {
          await findUserFamily(currentUser)
        } else {
          resetAppState()
        }
      }
    )

    const onlineHandler = () => setOnline(true)
    const offlineHandler = () => setOnline(false)

    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)

    return () => {
      unsub()

      window.removeEventListener(
        'online',
        onlineHandler
      )

      window.removeEventListener(
        'offline',
        offlineHandler
      )
    }
  }, [])

  function resetAppState() {
    setRole(null)
    setFamilyCode('')
    setFamilyData(null)
    setChildren([])
    setSafeZones([])
    setPlaces([])
    setAlerts([])
    setEvents([])
    setCheckIns([])
    setLocation(null)
    setTracking(false)
  }

  async function findUserFamily(currentUser) {
    try {
      const familiesSnapshot = await getDocs(
        collection(db, 'families')
      )

      for (const familyDoc of familiesSnapshot.docs) {
        const data = familyDoc.data()

        if (data.parentId === currentUser.uid) {
          setFamilyCode(familyDoc.id)
          setFamilyData({
            id: familyDoc.id,
            ...data,
          })
          setRole('parent')
          return
        }

        const member = await getDocs(
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

        if (!member.empty) {
          setFamilyCode(familyDoc.id)

          setFamilyData({
            id: familyDoc.id,
            ...data,
            memberData: member.docs[0].data(),
          })

          setRole(
            member.docs[0].data().role || 'child'
          )

          return
        }
      }
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (!familyCode) return

    const familyRef = doc(
      db,
      'families',
      familyCode
    )

    const unsubFamily = onSnapshot(
      familyRef,
      (snap) => {
        if (!snap.exists()) return

        const data = snap.data()

        setFamilyData({
          id: snap.id,
          ...data,
        })

        setSafeZones(
          normalizeSafeZones(data)
        )

        setPlaces(
          Array.isArray(data.places)
            ? data.places
            : []
        )
      },
      (err) => setError(err.message)
    )

    let unsubMembers = () => {}

    if (role === 'parent') {
      unsubMembers = onSnapshot(
        collection(
          db,
          'families',
          familyCode,
          'members'
        ),
        (snap) => {
          setChildren(
            snap.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            }))
          )
        },
        (err) => setError(err.message)
      )
    }

    return () => {
      unsubFamily()
      unsubMembers()
    }
  }, [familyCode, role])

  useEffect(() => {
    if (!familyCode || !user) return

    const memberRef = doc(
      db,
      'families',
      familyCode,
      'members',
      user.uid
    )

    const unsub = onSnapshot(memberRef, (snap) => {
      if (!snap.exists()) return

      const data = snap.data()

      if (
        typeof data.latitude === 'number' &&
        typeof data.longitude === 'number'
      ) {
        setLocation({
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy,
          speed: data.speed,
          batteryLevel: data.batteryLevel,
        })
      }

      setSafeZoneStatus(
        data.safeZoneStatus || 'unknown'
      )

      setDistanceFromSafeZone(
        typeof data.distanceFromSafeZone === 'number'
          ? data.distanceFromSafeZone
          : null
      )
    })

    return () => unsub()
  }, [familyCode, user])

  useEffect(() => {
    if (!familyCode || role !== 'parent') return

    const unsub = onSnapshot(
      query(
        collection(
          db,
          'families',
          familyCode,
          'alerts'
        ),
        orderBy('createdAt', 'desc'),
        limit(30)
      ),
      (snap) => {
        setAlerts(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        )
      },
      () => {}
    )

    return () => unsub()
  }, [familyCode, role])

  useEffect(() => {
    if (!familyCode || role !== 'parent') return

    const unsub = onSnapshot(
      query(
        collection(
          db,
          'families',
          familyCode,
          'events'
        ),
        orderBy('createdAt', 'desc'),
        limit(50)
      ),
      (snap) => {
        setEvents(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        )
      },
      () => {}
    )

    return () => unsub()
  }, [familyCode, role])

  useEffect(() => {
    if (!familyCode || role !== 'parent') return

    const unsub = onSnapshot(
      query(
        collection(
          db,
          'families',
          familyCode,
          'checkIns'
        ),
        orderBy('requestedAt', 'desc'),
        limit(30)
      ),
      (snap) => {
        setCheckIns(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        )
      },
      () => {}
    )

    return () => unsub()
  }, [familyCode, role])

  useEffect(() => {
    if (!familyCode || role !== 'parent') return

    children.forEach((child) => {
      const previous =
        previousStatusRef.current[child.id]

      if (
        previous &&
        child.safeZoneStatus &&
        child.safeZoneStatus !== previous
      ) {
        if (
          child.safeZoneStatus === 'outside'
        ) {
          createAlert(
            child,
            'safe_zone_exit',
            'Left safe zone',
            `${child.email || 'Child'} has left all safe zones.`
          )
        }

        if (
          child.safeZoneStatus === 'inside'
        ) {
          createAlert(
            child,
            'safe_zone_enter',
            'Entered safe zone',
            `${child.email || 'Child'} entered a safe zone.`
          )
        }
      }

      previousStatusRef.current[child.id] =
        child.safeZoneStatus || 'unknown'
    })
  }, [children, familyCode, role])

  useEffect(() => {
    if (!familyCode || role !== 'parent') return

    if (
      notificationPermission === 'granted'
    ) {
      registerForPushNotifications()
    }
  }, [
    familyCode,
    role,
    notificationPermission,
  ])

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(
          watchIdRef.current
        )
      }

      if (sosTimerRef.current) {
        clearInterval(sosTimerRef.current)
      }
    }
  }, [])

  async function register() {
    clearMessages()

    if (!email || !password) {
      return setError(
        'Please enter email and password.'
      )
    }

    try {
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      )

      setMessage(
        'Account created successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function login() {
    clearMessages()

    if (!email || !password) {
      return setError(
        'Please enter email and password.'
      )
    }

    try {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      )

      setMessage('Logged in successfully.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function loginWithGoogle() {
    clearMessages()

    try {
      await signInWithPopup(
        auth,
        new GoogleAuthProvider()
      )

      setMessage('Logged in successfully.')
    } catch (err) {
      setError(err.message)
    }
  }

  function clearMessages() {
    setError('')
    setMessage('')
  }

  async function createFamily() {
    if (!user) return

    clearMessages()

    try {
      let code = ''

      for (let i = 0; i < 5; i++) {
        const candidate = Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()

        const existing = await getDoc(
          doc(db, 'families', candidate)
        )

        if (!existing.exists()) {
          code = candidate
          break
        }
      }

      if (!code) {
        code = Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()
      }

      await setDoc(
        doc(db, 'families', code),
        {
          parentId: user.uid,
          parentEmail: user.email || '',
          familyCode: code,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          safeZones: [],
          places: [],
          settings: {
            smartAlerts: true,
            defaultCheckInMinutes: 30,
          },
        }
      )

      setFamilyCode(code)
      setRole('parent')

      setFamilyData({
        id: code,
        parentId: user.uid,
        parentEmail: user.email || '',
        familyCode: code,
        safeZones: [],
        places: [],
      })

      setMessage(
        'Family created successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function joinFamily() {
    if (!user || !joinCode.trim()) return

    clearMessages()

    try {
      const code = joinCode
        .trim()
        .toUpperCase()

      const familySnap = await getDocs(
        query(
          collection(db, 'families'),
          where('__name__', '==', code)
        )
      )

      if (familySnap.empty) {
        return setError(
          'Family code not found.'
        )
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
          email: user.email || '',
          role: 'child',
          joinedAt: serverTimestamp(),
          isOnline: true,
        },
        { merge: true }
      )

      setFamilyCode(code)
      setRole('child')

      setFamilyData({
        id: code,
        ...familySnap.docs[0].data(),
      })

      setMessage(
        'You joined the family successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  function computeZoneStatus(
    latitude,
    longitude,
    accuracy
  ) {
    if (
      !safeZones.length ||
      accuracy > 50
    ) {
      return {
        status: 'unknown',
        distance: null,
        zone: null,
      }
    }

    let min = Infinity
    let nearest = null

    safeZones.forEach((z) => {
      const d = distanceMeters(
        latitude,
        longitude,
        z.latitude,
        z.longitude
      )

      if (d < min) {
        min = d
        nearest = z
      }
    })

    return {
      status:
        min <= nearest.radius
          ? 'inside'
          : 'outside',
      distance: min,
      zone: nearest,
    }
  }

  async function getBatteryLevel() {
    try {
      if (!navigator.getBattery) return null

      const battery =
        await navigator.getBattery()

      return Math.round(
        battery.level * 100
      )
    } catch {
      return null
    }
  }

  async function startLocationTracking() {
    clearMessages()

    if (!navigator.geolocation) {
      return setError(
        'Geolocation is not supported by this browser.'
      )
    }

    if (!familyCode || !user) {
      return setError(
        'You are not connected to a family.'
      )
    }

    if (watchIdRef.current != null) {
      return
    }

    setMessage(
      'Starting live location...'
    )

    watchIdRef.current =
      navigator.geolocation.watchPosition(
        async (position) => {
          const now = Date.now()

          if (
            now -
              lastLocationSentRef.current <
            30000
          ) {
            return
          }

          lastLocationSentRef.current = now

          const {
            latitude,
            longitude,
            accuracy,
            speed,
          } = position.coords

          const computedSpeed =
            typeof speed === 'number' &&
            speed >= 0
              ? speed * 3.6
              : null

          const batteryLevel =
            await getBatteryLevel()

          const zone =
            computeZoneStatus(
              latitude,
              longitude,
              accuracy
            )

          setLocation({
            latitude,
            longitude,
            accuracy,
            speed: computedSpeed,
            batteryLevel,
          })

          setSafeZoneStatus(zone.status)
          setDistanceFromSafeZone(
            zone.distance
          )

          const memberRef = doc(
            db,
            'families',
            familyCode,
            'members',
            user.uid
          )

          try {
            await setDoc(
              memberRef,
              {
                userId: user.uid,
                email: user.email || '',
                role: 'child',
                latitude,
                longitude,
                accuracy,
                speed: computedSpeed,
                batteryLevel,
                isOnline: true,
                locationUpdatedAt:
                  serverTimestamp(),
                safeZoneStatus:
                  zone.status,
                distanceFromSafeZone:
                  zone.distance,
                nearestZoneId:
                  zone.zone?.id || null,
              },
              { merge: true }
            )

            await addDoc(
              collection(
                db,
                'families',
                familyCode,
                'locationHistory'
              ),
              {
                userId: user.uid,
                lat: latitude,
                lon: longitude,
                accuracy,
                speed: computedSpeed,
                batteryLevel,
                timestamp:
                  serverTimestamp(),
              }
            )

            await processPlaceEvents(
              latitude,
              longitude
            )

            if (
              computedSpeed != null &&
              computedSpeed >= 100
            ) {
              await createChildAlert(
                'high_speed',
                'High speed detected',
                `Possible high speed: ${Math.round(
                  computedSpeed
                )} km/h`,
                latitude,
                longitude
              )
            }

            setMessage(
              'Live location updated.'
            )
          } catch (err) {
            setError(err.message)
          }
        },
        (err) => setError(err.message),
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 20000,
        }
      )

    setTracking(true)
  }

  function stopLocationTracking() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      )
    }

    watchIdRef.current = null
    setTracking(false)

    if (user && familyCode) {
      updateDoc(
        doc(
          db,
          'families',
          familyCode,
          'members',
          user.uid
        ),
        {
          isOnline: false,
        }
      ).catch(() => {})
    }

    setMessage(
      'Live location stopped.'
    )
  }

  async function processPlaceEvents(
    latitude,
    longitude
  ) {
    if (!places.length) return

    for (
      const place of places.filter(
        (p) => p.enabled !== false
      )
    ) {
      const inside =
        distanceMeters(
          latitude,
          longitude,
          place.latitude,
          place.longitude
        ) <= place.radius

      const previous =
        previousPlaceStateRef.current[
          place.id
        ]

      previousPlaceStateRef.current[
        place.id
      ] = inside

      if (previous === undefined) {
        continue
      }

      if (inside !== previous) {
        await addDoc(
          collection(
            db,
            'families',
            familyCode,
            'events'
          ),
          {
            userId: user.uid,
            type: inside
              ? 'arrival'
              : 'departure',
            placeId: place.id,
            placeName: place.name,
            lat: latitude,
            lon: longitude,
            createdAt:
              serverTimestamp(),
          }
        )

        if (inside) {
          await createChildAlert(
            'arrival',
            `Arrived at ${place.name}`,
            `${
              user.email || 'Child'
            } arrived at ${place.name}.`,
            latitude,
            longitude
          )
        } else {
          await createChildAlert(
            'departure',
            `Left ${place.name}`,
            `${
              user.email || 'Child'
            } left ${place.name}.`,
            latitude,
            longitude
          )
        }
      }
    }
  }

  async function createAlert(
    child,
    type,
    title,
    body
  ) {
    if (!familyCode) return

    try {
      await addDoc(
        collection(
          db,
          'families',
          familyCode,
          'alerts'
        ),
        {
          userId: child.id,
          type,
          title,
          body,
          lat:
            child.latitude ?? null,
          lon:
            child.longitude ?? null,
          createdAt:
            serverTimestamp(),
        }
      )

      sendParentNotification(
        title,
        body
      )
    } catch (err) {
      console.error(err)
    }
  }

  async function createChildAlert(
    type,
    title,
    body,
    lat,
    lon
  ) {
    if (!familyCode || !user) return

    try {
      await addDoc(
        collection(
          db,
          'families',
          familyCode,
          'alerts'
        ),
        {
          userId: user.uid,
          type,
          title,
          body,
          lat:
            lat ??
            location?.latitude ??
            null,
          lon:
            lon ??
            location?.longitude ??
            null,
          createdAt:
            serverTimestamp(),
        }
      )
    } catch (err) {
      console.error(err)
    }
  }

  async function sendParentNotification(
    title,
    body
  ) {
    if (!familyCode) return

    let token = localStorage.getItem(
      'familytrack_fcm_token'
    )

    if (
      !token &&
      user &&
      role === 'parent'
    ) {
      try {
        token = (
          await getDoc(
            doc(
              db,
              'families',
              familyCode,
              'guardians',
              user.uid
            )
          )
        ).data()?.fcmToken || null
      } catch {}
    }

    if (!token) return

    try {
      await fetch(
        NOTIFICATION_WORKER_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            token,
            title,
            body,
          }),
        }
      )
    } catch (err) {
      console.error(err)
    }
  }

  async function requestNotificationPermission() {
    if (
      typeof Notification ===
      'undefined'
    ) {
      return setError(
        'Notifications are not supported by this browser.'
      )
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
        !user ||
        !familyCode ||
        role !== 'parent' ||
        typeof Notification ===
          'undefined' ||
        Notification.permission !==
          'granted'
      ) {
        return
      }

      if (!(await isSupported())) {
        return
      }

      const messaging =
        getMessaging()

      const registration =
        await navigator.serviceWorker.register(
          '/familytrack/firebase-messaging-sw.js'
        )

      const token = await getToken(
        messaging,
        {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration:
            registration,
        }
      )

      if (!token) return

      localStorage.setItem(
        'familytrack_fcm_token',
        token
      )

      await setDoc(
        doc(
          db,
          'families',
          familyCode,
          'guardians',
          user.uid
        ),
        {
          userId: user.uid,
          email: user.email || '',
          role: 'owner',
          fcmToken: token,
          fcmTokenUpdatedAt:
            serverTimestamp(),
        },
        { merge: true }
      )

      setFcmReady(true)
    } catch (err) {
      console.error(err)
      setFcmReady(false)
    }
  }

  async function addSafeZone(position) {
    if (!position || role !== 'parent') {
      return
    }

    clearMessages()

    const zone = {
      id: uid('zone'),
      name:
        zoneName.trim() ||
        `Safe Zone ${
          safeZones.length + 1
        }`,
      latitude: position.latitude,
      longitude: position.longitude,
      radius:
        Number(zoneRadius) ||
        DEFAULT_RADIUS,
    }

    const next = [
      ...safeZones,
      zone,
    ]

    try {
      await updateDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          safeZones: next,
          updatedAt:
            serverTimestamp(),
        }
      )

      setZoneName('')
      setMessage(
        'Safe zone added.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteSafeZone(id) {
    try {
      await updateDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          safeZones:
            safeZones.filter(
              (z) => z.id !== id
            ),
          updatedAt:
            serverTimestamp(),
        }
      )

      setMessage(
        'Safe zone deleted.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function addPlace() {
    if (
      !pendingPlace ||
      !placeName.trim()
    ) {
      return setError(
        'Choose a location on the map and enter a place name.'
      )
    }

    const place = {
      id: uid('place'),
      name: placeName.trim(),
      type: placeType,
      latitude:
        pendingPlace.latitude,
      longitude:
        pendingPlace.longitude,
      radius:
        Number(placeRadius) || 150,
      enabled: true,
    }

    try {
      await updateDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          places: [
            ...places,
            place,
          ],
          updatedAt:
            serverTimestamp(),
        }
      )

      setPendingPlace(null)
      setPlaceName('')

      setMessage(
        'Place added.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function deletePlace(id) {
    try {
      await updateDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          places:
            places.filter(
              (p) => p.id !== id
            ),
          updatedAt:
            serverTimestamp(),
        }
      )

      setMessage(
        'Place deleted.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function sendSOS() {
    if (
      !familyCode ||
      !user ||
      !location
    ) {
      return setError(
        'Start live location first so the SOS includes your current location.'
      )
    }

    clearMessages()

    setSosCountdown(5)

    let n = 5

    sosTimerRef.current =
      setInterval(async () => {
        n -= 1

        setSosCountdown(n)

        if (n <= 0) {
          clearInterval(
            sosTimerRef.current
          )

          sosTimerRef.current =
            null

          setSosCountdown(null)

          const title =
            '🚨 SOS Emergency Alert'

          const body = `${
            user.email ||
            'Family member'
          } needs help. Location: ${location.latitude.toFixed(
            5
          )}, ${location.longitude.toFixed(
            5
          )}`

          await createChildAlert(
            'sos',
            title,
            body,
            location.latitude,
            location.longitude
          )

          await addDoc(
            collection(
              db,
              'families',
              familyCode,
              'events'
            ),
            {
              userId: user.uid,
              type: 'sos',
              title,
              lat:
                location.latitude,
              lon:
                location.longitude,
              createdAt:
                serverTimestamp(),
            }
          )

          await sendParentNotification(
            title,
            body
          )

          setMessage(
            'SOS alert sent to the parent.'
          )
        }
      }, 1000)
  }

  function cancelSOS() {
    if (sosTimerRef.current) {
      clearInterval(
        sosTimerRef.current
      )
    }

    sosTimerRef.current = null

    setSosCountdown(null)

    setMessage(
      'SOS cancelled.'
    )
  }

  async function checkIn() {
    if (!familyCode || !user) return

    try {
      await addDoc(
        collection(
          db,
          'families',
          familyCode,
          'checkIns'
        ),
        {
          userId: user.uid,
          requestedAt:
            serverTimestamp(),
          respondedAt:
            serverTimestamp(),
          status: 'safe',
        }
      )

      await createChildAlert(
        'check_in',
        'I am safe',
        `${
          user.email ||
          'Family member'
        } checked in as safe.`
      )

      setMessage(
        'Check-in sent.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function requestCheckIn(
    childId
  ) {
    try {
      await addDoc(
        collection(
          db,
          'families',
          familyCode,
          'checkIns'
        ),
        {
          userId: childId,
          requestedAt:
            serverTimestamp(),
          status: 'requested',
        }
      )

      setMessage(
        'Safety check requested.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function loadHistory(
    childId
  ) {
    if (!childId) return

    setSelectedChildId(childId)
    setShowHistory(true)

    try {
      const snap = await getDocs(
        query(
          collection(
            db,
            'families',
            familyCode,
            'locationHistory'
          ),
          where(
            'userId',
            '==',
            childId
          ),
          limit(100)
        )
      )

      const rows = snap.docs.map(
        (d) => ({
          id: d.id,
          ...d.data(),
        })
      )

      rows.sort((a, b) => {
        const at =
          a.timestamp?.toMillis?.() ||
          0

        const bt =
          b.timestamp?.toMillis?.() ||
          0

        return bt - at
      })

      setHistory(rows)
    } catch (err) {
      setError(err.message)
    }
  }

  async function acknowledgeAlert(
    alertId
  ) {
    try {
      await updateDoc(
        doc(
          db,
          'families',
          familyCode,
          'alerts',
          alertId
        ),
        {
          acknowledgedAt:
            serverTimestamp(),
          acknowledgedBy:
            user.uid,
        }
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function logout() {
    stopLocationTracking()

    await signOut(auth)

    resetAppState()
    setUser(null)
  }

  if (loading) {
    return (
      <div style={styles.center}>
        <h2>FamilyTrack</h2>
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={styles.page}>
        <div style={styles.authCard}>
          <h1>🏠 FamilyTrack</h1>

          <p style={styles.muted}>
            Family safety and location
            tracking
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
              setPassword(
                e.target.value
              )
            }
          />

          <button
            style={styles.primary}
            onClick={login}
          >
            Login
          </button>

          <button
            style={styles.secondary}
            onClick={register}
          >
            Create Account
          </button>

          <div style={styles.divider}>
            OR
          </div>

          <button
            style={styles.google}
            onClick={loginWithGoogle}
          >
            Continue with Google
          </button>

          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}

          {message && (
            <div style={styles.success}>
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
          <Header
            email={user.email}
            onLogout={logout}
          />

          <h2>
            Set up your family
          </h2>

          <button
            style={styles.primary}
            onClick={createFamily}
          >
            👨‍👩‍👧 Create New Family
          </button>

          <input
            style={styles.input}
            placeholder="Family Code"
            value={joinCode}
            onChange={(e) =>
              setJoinCode(
                e.target.value
              )
            }
          />

          <button
            style={styles.secondary}
            onClick={joinFamily}
          >
            Join Existing Family
          </button>

          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}

          {message && (
            <div style={styles.success}>
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

          <div style={styles.banner}>
            <strong>
              Family Code:
            </strong>{' '}
            {familyCode}
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.stat}>
              <strong>
                {tracking
                  ? 'ON'
                  : 'OFF'}
              </strong>
              <span>
                Live location
              </span>
            </div>

            <div style={styles.stat}>
              <strong>
                {safeZoneStatus ===
                'inside'
                  ? 'SAFE'
                  : safeZoneStatus ===
                    'outside'
                  ? 'OUT'
                  : '—'}
              </strong>

              <span>
                Zone status
              </span>
            </div>

            <div style={styles.stat}>
              <strong>
                {location?.batteryLevel !=
                null
                  ? `${location.batteryLevel}%`
                  : '—'}
              </strong>

              <span>
                Battery
              </span>
            </div>
          </div>

          <Card title="📍 Location Sharing">
            <p>
              {tracking
                ? '🟢 Live location is active'
                : '⚪ Location sharing is stopped'}
            </p>

            {!tracking ? (
              <button
                style={styles.primary}
                onClick={
                  startLocationTracking
                }
              >
                Start Live Location
              </button>
            ) : (
              <button
                style={styles.danger}
                onClick={
                  stopLocationTracking
                }
              >
                Stop Live Location
              </button>
            )}
          </Card>

          <Card title="🚨 Quick Safety Actions">
            <div style={styles.actionGrid}>
              {sosCountdown == null ? (
                <button
                  style={styles.sos}
                  onClick={sendSOS}
                >
                  🚨 SOS
                </button>
              ) : (
                <button
                  style={styles.danger}
                  onClick={cancelSOS}
                >
                  Cancel SOS (
                  {sosCountdown})
                </button>
              )}

              <button
                style={styles.secondary}
                onClick={checkIn}
              >
                ✅ I’m Safe
              </button>
            </div>

            <p style={styles.muted}>
              SOS sends an alert with
              your last available
              location. You can cancel
              during the 5-second
              countdown.
            </p>
          </Card>

          <Card title="🛡️ Safety Status">
            <p
              style={
                safeZoneStatus ===
                'inside'
                  ? styles.good
                  : safeZoneStatus ===
                    'outside'
                  ? styles.bad
                  : styles.muted
              }
            >
              {safeZoneStatus ===
              'inside'
                ? '🟢 You are inside a safe zone.'
                : safeZoneStatus ===
                  'outside'
                ? '🔴 You are outside all safe zones.'
                : '🟡 Location accuracy is not sufficient or no safe zone is configured.'}
            </p>

            <p>
              Nearest zone distance:{' '}
              {formatDistance(
                distanceFromSafeZone
              )}
            </p>

            <p>
              Speed:{' '}
              {location?.speed != null
                ? `${Math.round(
                    location.speed
                  )} km/h`
                : '—'}
            </p>

            <p>
              Accuracy:{' '}
              {location?.accuracy !=
              null
                ? `${Math.round(
                    location.accuracy
                  )} m`
                : '—'}
            </p>
          </Card>

          {location && (
            <Card title="📍 Current Location">
              <p>
                {location.latitude.toFixed(
                  6
                )}
                ,{' '}
                {location.longitude.toFixed(
                  6
                )}
              </p>
            </Card>
          )}

          {message && (
            <div style={styles.success}>
              {message}
            </div>
          )}

          {error && (
            <div style={styles.error}>
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

        <div style={styles.banner}>
          <strong>
            Family Code:
          </strong>

          <span style={styles.code}>
            {familyCode}
          </span>

          <span style={styles.statusDot}>
            {online
              ? '🟢 Online'
              : '🔴 Offline'}
          </span>
        </div>

        <div style={styles.statsGrid}>
          <div style={styles.stat}>
            <strong>
              {children.length}
            </strong>

            <span>
              Children
            </span>
          </div>

          <div style={styles.stat}>
            <strong>
              {
                children.filter(
                  (c) =>
                    typeof c.latitude ===
                    'number'
                ).length
              }
            </strong>

            <span>
              Locations shared
            </span>
          </div>

          <div style={styles.stat}>
            <strong>
              {
                alerts.filter(
                  (a) =>
                    !a.acknowledgedAt
                ).length
              }
            </strong>

            <span>
              Open alerts
            </span>
          </div>
        </div>

        <Card
          title="🔔 Parent Notifications"
          action={
            fcmReady ? (
              <span style={styles.good}>
                Ready
              </span>
            ) : null
          }
        >
          {notificationPermission !==
          'granted' ? (
            <button
              style={styles.primary}
              onClick={
                requestNotificationPermission
              }
            >
              Enable Push Notifications
            </button>
          ) : (
            <p>
              🟢 Browser notifications
              enabled.
            </p>
          )}
        </Card>

        <Card title="🗺️ Family Map">
          <MapContainer
            center={
              currentChild?.latitude
                ? [
                    currentChild.latitude,
                    currentChild.longitude,
                  ]
                : defaultCenter
            }
            zoom={13}
            scrollWheelZoom
            style={{
              height: 420,
              width: '100%',
              borderRadius: 14,
            }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapPicker
              onPick={(p) => {
                if (
                  mapPickMode ===
                  'zone'
                ) {
                  addSafeZone(p)
                } else {
                  setPendingPlace(p)
                  setMapPickMode(
                    'zone'
                  )
                  setMessage(
                    'Map location selected for the new place.'
                  )
                }
              }}
            />

            {safeZones.map((z) => (
              <Circle
                key={z.id}
                center={[
                  z.latitude,
                  z.longitude,
                ]}
                radius={z.radius}
              >
                <Popup>
                  {z.name} —{' '}
                  {z.radius} m
                </Popup>
              </Circle>
            ))}

            {places.map((p) => (
              <CircleMarker
                key={p.id}
                center={[
                  p.latitude,
                  p.longitude,
                ]}
                radius={8}
              >
                <Popup>
                  {p.name} —{' '}
                  {p.type}
                </Popup>
              </CircleMarker>
            ))}

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

                      {child.safeZoneStatus ===
                      'outside'
                        ? '🔴 Outside'
                        : child.safeZoneStatus ===
                          'inside'
                        ? '🟢 Inside'
                        : '🟡 Unknown'}

                      <br />

                      Accuracy:{' '}
                      {Math.round(
                        child.accuracy ||
                          0
                      )}{' '}
                      m

                      <br />

                      Speed:{' '}
                      {child.speed !=
                      null
                        ? `${Math.round(
                            child.speed
                          )} km/h`
                        : '—'}
                    </Popup>
                  </Marker>
                )
            )}
          </MapContainer>

          <p style={styles.muted}>
            {mapPickMode === 'zone'
              ? 'Map click adds a safe zone using the name and radius above.'
              : 'Map click will select a location for the new named place.'}
          </p>
        </Card>

        <Card title="🛡️ Safe Zones">
          <div style={styles.formGrid}>
            <input
              style={styles.input}
              placeholder="Zone name (optional)"
              value={zoneName}
              onChange={(e) =>
                setZoneName(
                  e.target.value
                )
              }
            />

            <input
              style={styles.input}
              type="number"
              min="25"
              max="5000"
              value={zoneRadius}
              onChange={(e) =>
                setZoneRadius(
                  e.target.value
                )
              }
            />
          </div>

          <p style={styles.muted}>
            Clicking the map adds a
            zone using the current
            name/radius.
          </p>

          {safeZones.length === 0 ? (
            <p>
              No safe zones configured.
            </p>
          ) : (
            safeZones.map((z) => (
              <div
                key={z.id}
                style={styles.row}
              >
                <div>
                  <strong>
                    {z.name}
                  </strong>

                  <div
                    style={
                      styles.muted
                    }
                  >
                    {z.radius} m ·{' '}
                    {z.latitude.toFixed(
                      5
                    )}
                    ,{' '}
                    {z.longitude.toFixed(
                      5
                    )}
                  </div>
                </div>

                <button
                  style={
                    styles.smallDanger
                  }
                  onClick={() =>
                    deleteSafeZone(
                      z.id
                    )
                  }
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </Card>

        <Card title="📍 Named Places">
          <div style={styles.formGrid}>
            <input
              style={styles.input}
              placeholder="Place name"
              value={placeName}
              onChange={(e) =>
                setPlaceName(
                  e.target.value
                )
              }
            />

            <select
              style={styles.input}
              value={placeType}
              onChange={(e) =>
                setPlaceType(
                  e.target.value
                )
              }
            >
              <option>
                Home
              </option>

              <option>
                School
              </option>

              <option>
                Work
              </option>

              <option>
                Grandparents
              </option>

              <option>
                Club
              </option>

              <option>
                Other
              </option>
            </select>

            <input
              style={styles.input}
              type="number"
              min="25"
              max="5000"
              value={placeRadius}
              onChange={(e) =>
                setPlaceRadius(
                  e.target.value
                )
              }
            />
          </div>

          <button
            style={styles.secondary}
            onClick={() =>
              setMapPickMode('place')
            }
          >
            {mapPickMode ===
            'place'
              ? '📍 Click the map now'
              : '📍 Choose place location on map'}
          </button>

          <button
            style={styles.secondary}
            onClick={addPlace}
            disabled={!pendingPlace}
          >
            Add selected map location
            as place
          </button>

          {places.map((p) => (
            <div
              key={p.id}
              style={styles.row}
            >
              <div>
                <strong>
                  {p.name}
                </strong>

                <div
                  style={
                    styles.muted
                  }
                >
                  {p.type} · radius{' '}
                  {p.radius} m
                </div>
              </div>

              <button
                style={
                  styles.smallDanger
                }
                onClick={() =>
                  deletePlace(p.id)
                }
              >
                Delete
              </button>
            </div>
          ))}
        </Card>

        <Card title="👨‍👩‍👧 Children">
          {children.length === 0 ? (
            <p>
              No children have joined
              yet.
            </p>
          ) : (
            children.map((child) => (
              <div
                key={child.id}
                style={
                  styles.childCard
                }
              >
                <div>
                  <strong>
                    {child.email ||
                      'Child'}
                  </strong>

                  <div
                    style={
                      styles.muted
                    }
                  >
                    {child.isOnline
                      ? '🟢 Online'
                      : '⚪ Offline'}{' '}
                    ·{' '}
                    {child.locationUpdatedAt
                      ? formatDate(
                          child.locationUpdatedAt
                        )
                      : 'No location yet'}
                  </div>

                  <div>
                    {child.safeZoneStatus ===
                    'outside'
                      ? '🔴 Outside all safe zones'
                      : child.safeZoneStatus ===
                        'inside'
                      ? '🟢 Inside a safe zone'
                      : '🟡 Status unknown'}
                  </div>
                </div>

                <div
                  style={
                    styles.actionGrid
                  }
                >
                  <button
                    style={
                      styles.smallButton
                    }
                    onClick={() =>
                      loadHistory(
                        child.id
                      )
                    }
                  >
                    Timeline
                  </button>

                  <button
                    style={
                      styles.smallButton
                    }
                    onClick={() =>
                      requestCheckIn(
                        child.id
                      )
                    }
                  >
                    Check-in
                  </button>

                  <a
                    style={
                      styles.callButton
                    }
                    href={`tel:${
                      child.phone || ''
                    }`}
                    onClick={(e) => {
                      if (
                        !child.phone
                      ) {
                        e.preventDefault()
                      }
                    }}
                  >
                    {child.phone
                      ? '📞 Call'
                      : '📞 No phone'}
                  </a>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card title="🚨 Alerts">
          {alerts.length === 0 ? (
            <p>
              No alerts yet.
            </p>
          ) : (
            alerts
              .slice(0, 15)
              .map((a) => (
                <div
                  key={a.id}
                  style={
                    styles.alertRow
                  }
                >
                  <div>
                    <strong>
                      {a.title}
                    </strong>

                    <div>
                      {a.body}
                    </div>

                    <div
                      style={
                        styles.muted
                      }
                    >
                      {formatDate(
                        a.createdAt
                      )}
                    </div>
                  </div>

                  {!a.acknowledgedAt && (
                    <button
                      style={
                        styles.smallButton
                      }
                      onClick={() =>
                        acknowledgeAlert(
                          a.id
                        )
                      }
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              ))
          )}
        </Card>

        <Card title="🧭 Family Timeline">
          {events.length === 0 ? (
            <p>
              No events yet.
            </p>
          ) : (
            events
              .slice(0, 20)
              .map((e) => (
                <div
                  key={e.id}
                  style={
                    styles.timelineItem
                  }
                >
                  <strong>
                    {e.title ||
                      e.type}
                  </strong>

                  <span>
                    {formatDate(
                      e.createdAt
                    )}
                  </span>
                </div>
              ))
          )}
        </Card>

        {showHistory && (
          <Card
            title={`📍 Location History — ${
              currentChild?.email ||
              ''
            }`}
            action={
              <button
                style={
                  styles.smallButton
                }
                onClick={() =>
                  setShowHistory(
                    false
                  )
                }
              >
                Close
              </button>
            }
          >
            {history.length === 0 ? (
              <p>
                No history found.
              </p>
            ) : (
              history.map((h) => (
                <div
                  key={h.id}
                  style={
                    styles.timelineItem
                  }
                >
                  <span>
                    {formatDate(
                      h.timestamp
                    )}
                  </span>

                  <span>
                    {h.lat?.toFixed?.(
                      5
                    )}
                    ,{' '}
                    {h.lon?.toFixed?.(
                      5
                    )}{' '}
                    ·{' '}
                    {h.speed != null
                      ? `${Math.round(
                          h.speed
                        )} km/h`
                      : '—'}
                  </span>
                </div>
              ))
            )}
          </Card>
        )}

        {message && (
          <div style={styles.success}>
            {message}
          </div>
        )}

        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f5f7fa',
    padding: 20,
  },

  center: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'Arial, sans-serif',
  },

  authCard: {
    width: '100%',
    maxWidth: 440,
    margin: '60px auto',
    background: '#fff',
    padding: 28,
    borderRadius: 18,
    boxShadow:
      '0 8px 30px rgba(0,0,0,.08)',
  },

  dashboard: {
    maxWidth: 1100,
    margin: '0 auto',
    fontFamily: 'Arial, sans-serif',
  },

  card: {
    background: '#fff',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
    boxShadow:
      '0 3px 14px rgba(0,0,0,.06)',
  },

  cardTitle: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    gap: 12,
  },

  header: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    background: '#fff',
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
  },

  input: {
    width: '100%',
    padding: 12,
    border:
      '1px solid #d8dde5',
    borderRadius: 10,
    marginBottom: 10,
    fontSize: 15,
  },

  primary: {
    width: '100%',
    border: 0,
    padding: 12,
    borderRadius: 10,
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
    marginBottom: 10,
  },

  secondary: {
    width: '100%',
    border:
      '1px solid #2563eb',
    padding: 12,
    borderRadius: 10,
    background: '#fff',
    color: '#2563eb',
    cursor: 'pointer',
    fontWeight: 700,
    marginBottom: 10,
  },

  google: {
    width: '100%',
    border: '1px solid #ddd',
    padding: 12,
    borderRadius: 10,
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
  },

  danger: {
    width: '100%',
    border: 0,
    padding: 12,
    borderRadius: 10,
    background: '#dc2626',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
  },

  sos: {
    width: '100%',
    border: 0,
    padding: 15,
    borderRadius: 12,
    background: '#b91c1c',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 800,
    fontSize: 18,
  },

  smallButton: {
    border:
      '1px solid #d8dde5',
    background: '#fff',
    padding: '8px 12px',
    borderRadius: 9,
    cursor: 'pointer',
  },

  smallDanger: {
    border: 0,
    background: '#fee2e2',
    color: '#991b1b',
    padding: '8px 12px',
    borderRadius: 9,
    cursor: 'pointer',
  },

  callButton: {
    textDecoration: 'none',
    border:
      '1px solid #16a34a',
    color: '#166534',
    padding: '8px 12px',
    borderRadius: 9,
  },

  divider: {
    textAlign: 'center',
    margin: '18px 0',
    color: '#888',
  },

  muted: {
    color: '#6b7280',
    fontSize: 13,
  },

  banner: {
    background: '#eff6ff',
    border:
      '1px solid #bfdbfe',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    flexWrap: 'wrap',
  },

  code: {
    fontFamily: 'monospace',
    fontWeight: 800,
    letterSpacing: 2,
  },

  statusDot: {
    marginLeft: 'auto',
  },

  statsGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(150px,1fr))',
    gap: 12,
    marginBottom: 16,
  },

  stat: {
    background: '#fff',
    padding: 18,
    borderRadius: 14,
    textAlign: 'center',
    boxShadow:
      '0 3px 12px rgba(0,0,0,.05)',
  },

  actionGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(140px,1fr))',
    gap: 10,
  },

  formGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit,minmax(160px,1fr))',
    gap: 10,
  },

  row: {
    display: 'flex',
    justifyContent:
      'space-between',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    borderBottom:
      '1px solid #eee',
  },

  childCard: {
    padding: 14,
    border:
      '1px solid #e5e7eb',
    borderRadius: 12,
    marginTop: 10,
    display: 'flex',
    justifyContent:
      'space-between',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
  },

  alertRow: {
    padding: 12,
    borderBottom:
      '1px solid #eee',
    display: 'flex',
    justifyContent:
      'space-between',
    gap: 12,
  },

  timelineItem: {
    display: 'flex',
    justifyContent:
      'space-between',
    gap: 12,
    padding: '10px 0',
    borderBottom:
      '1px solid #eee',
    flexWrap: 'wrap',
  },

  success: {
    background: '#dcfce7',
    color: '#166534',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },

  error: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },

  good: {
    color: '#15803d',
  },

  bad: {
    color: '#b91c1c',
  },
}
