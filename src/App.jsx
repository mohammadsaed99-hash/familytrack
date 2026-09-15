```jsx
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
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
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
  useMap,
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

function calculateDistance(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const R = 6371000

  const dLat =
    ((lat2 - lat1) * Math.PI) / 180

  const dLon =
    ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  )
}

/*
 * Convert old single safeZone format
 * into the new multiple safeZones format.
 */
function getSafeZonesFromFamilyData(data) {
  if (
    data &&
    Array.isArray(data.safeZones)
  ) {
    return data.safeZones
  }

  if (
    data &&
    data.safeZone &&
    typeof data.safeZone.latitude ===
      'number' &&
    typeof data.safeZone.longitude ===
      'number'
  ) {
    return [
      {
        id: 'legacy-safe-zone',
        name: 'Safe Zone',
        latitude: data.safeZone.latitude,
        longitude: data.safeZone.longitude,
        radius:
          typeof data.safeZone.radius ===
          'number'
            ? data.safeZone.radius
            : SAFE_ZONE_RADIUS,
      },
    ]
  }

  return []
}

function getLocationStatus(
  latitude,
  longitude,
  accuracy,
  safeZones
) {
  if (
    !Array.isArray(safeZones) ||
    safeZones.length === 0
  ) {
    return {
      status: 'unknown',
      distance: null,
      zone: null,
    }
  }

  if (accuracy > 50) {
    return {
      status: 'unknown',
      distance: null,
      zone: null,
    }
  }

  let nearestDistance = null
  let nearestZone = null

  for (const zone of safeZones) {
    if (
      typeof zone.latitude !== 'number' ||
      typeof zone.longitude !== 'number'
    ) {
      continue
    }

    const distance =
      calculateDistance(
        latitude,
        longitude,
        zone.latitude,
        zone.longitude
      )

    if (
      nearestDistance === null ||
      distance < nearestDistance
    ) {
      nearestDistance = distance
      nearestZone = zone
    }

    const radius =
      typeof zone.radius === 'number'
        ? zone.radius
        : SAFE_ZONE_RADIUS

    if (distance <= radius) {
      return {
        status: 'inside',
        distance,
        zone,
      }
    }
  }

  return {
    status: 'outside',
    distance: nearestDistance,
    zone: nearestZone,
  }
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

function MapFocus({ child }) {
  const map = useMap()

  useEffect(() => {
    if (
      child &&
      typeof child.latitude === 'number' &&
      typeof child.longitude === 'number'
    ) {
      map.flyTo(
        [child.latitude, child.longitude],
        17,
        {
          duration: 1,
        }
      )
    }
  }, [child, map])

  return null
}

function formatLastUpdate(timestamp) {
  if (!timestamp) {
    return 'Unknown'
  }

  try {
    const date =
      typeof timestamp.toDate === 'function'
        ? timestamp.toDate()
        : new Date(timestamp)

    if (Number.isNaN(date.getTime())) {
      return 'Unknown'
    }

    return date.toLocaleString()
  } catch {
    return 'Unknown'
  }
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

  const [safeZones, setSafeZones] = useState([])

  const [safeZoneStatus, setSafeZoneStatus] =
    useState('unknown')

  const [distanceFromSafeZone, setDistanceFromSafeZone] =
    useState(null)

  const [selectedChild, setSelectedChild] =
    useState(null)

  const [notificationPermission, setNotificationPermission] =
    useState(
      typeof Notification !== 'undefined'
        ? Notification.permission
        : 'default'
    )

  const [fcmReady, setFcmReady] = useState(false)

  const watchIdRef = useRef(null)

  const previousChildStatusRef =
    useRef({})

  /*
   * AUTHENTICATION
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        setUser(currentUser)

        if (!currentUser) {
          setRole(null)
          setFamilyCode('')
          setFamilyData(null)
          setChildren([])
          setSelectedChild(null)
          setLocation(null)
          setSafeZones([])
          setLoading(false)
          return
        }

        setLoading(true)

        await findUserFamily(currentUser)

        setLoading(false)
      }
    )

    return () => unsubscribe()
  }, [])

  /*
   * Restore family information after login
   */
  async function findUserFamily(currentUser) {
    try {
      const userRef = doc(
        db,
        'users',
        currentUser.uid
      )

      const userSnapshot =
        await getDoc(userRef)

      if (!userSnapshot.exists()) {
        setRole(null)
        setFamilyCode('')
        setFamilyData(null)
        setSafeZones([])
        return
      }

      const userData =
        userSnapshot.data()

      console.log(
        'Restored user data:',
        userData
      )

      if (
        !userData.familyCode ||
        !userData.role
      ) {
        setRole(null)
        setFamilyCode('')
        setFamilyData(null)
        setSafeZones([])
        return
      }

      const familyRef = doc(
        db,
        'families',
        userData.familyCode
      )

      const familySnapshot =
        await getDoc(familyRef)

      if (!familySnapshot.exists()) {
        setRole(null)
        setFamilyCode('')
        setFamilyData(null)
        setSafeZones([])
        return
      }

      const familyDataValue =
        familySnapshot.data()

      const restoredSafeZones =
        getSafeZonesFromFamilyData(
          familyDataValue
        )

      setFamilyCode(
        userData.familyCode
      )

      setFamilyData({
        id: familySnapshot.id,
        ...familyDataValue,
      })

      setSafeZones(
        restoredSafeZones
      )

      setRole(userData.role)

      console.log(
        'Family restored:',
        userData.familyCode,
        userData.role
      )
    } catch (err) {
      console.error(
        'Failed to restore user family:',
        err
      )

      setError(
        'Could not restore your family information.'
      )

      setRole(null)
      setFamilyCode('')
      setFamilyData(null)
      setSafeZones([])
    }
  }

  /*
   * Parent family listener
   */
  useEffect(() => {
    if (
      !familyCode ||
      role !== 'parent'
    ) {
      return
    }

    const familyRef = doc(
      db,
      'families',
      familyCode
    )

    const unsubscribeFamily =
      onSnapshot(
        familyRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data =
              snapshot.data()

            const zones =
              getSafeZonesFromFamilyData(
                data
              )

            setFamilyData({
              id: snapshot.id,
              ...data,
            })

            setSafeZones(zones)
          }
        },
        (err) => {
          console.error(
            'Family listener error:',
            err
          )
        }
      )

    const membersRef = collection(
      db,
      'families',
      familyCode,
      'members'
    )

    const unsubscribeMembers =
      onSnapshot(
        membersRef,
        (snapshot) => {
          const list =
            snapshot.docs.map(
              (item) => ({
                id: item.id,
                ...item.data(),
              })
            )

          setChildren(list)
        },
        (err) => {
          console.error(
            'Members listener error:',
            err
          )
        }
      )

    return () => {
      unsubscribeFamily()
      unsubscribeMembers()
    }
  }, [familyCode, role])

  /*
   * Child member listener
   */
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

    const unsubscribe =
      onSnapshot(
        memberRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            return
          }

          const data =
            snapshot.data()

          if (
            typeof data.latitude ===
              'number' &&
            typeof data.longitude ===
              'number'
          ) {
            setLocation({
              latitude:
                data.latitude,
              longitude:
                data.longitude,
              accuracy:
                data.accuracy,
            })

            setSafeZoneStatus(
              data.safeZoneStatus ||
                'unknown'
            )

            setDistanceFromSafeZone(
              typeof data.distanceFromSafeZone ===
                'number'
                ? data.distanceFromSafeZone
                : null
            )
          }
        },
        (err) => {
          console.error(
            'Child listener error:',
            err
          )
        }
      )

    return () => unsubscribe()
  }, [
    familyCode,
    role,
    user,
  ])

  /*
   * Parent Safe Zone notification listener
   */
  useEffect(() => {
    if (
      !familyCode ||
      role !== 'parent'
    ) {
      return
    }

    const unsubscribe =
      onSnapshot(
        collection(
          db,
          'families',
          familyCode,
          'members'
        ),
        (snapshot) => {
          snapshot.docs.forEach(
            (item) => {
              const child = {
                id: item.id,
                ...item.data(),
              }

              const previousStatus =
                previousChildStatusRef
                  .current[
                  child.id
                ]

              if (
                child.safeZoneStatus ===
                  'outside' &&
                previousStatus &&
                previousStatus !==
                  'outside'
              ) {
                sendParentNotification(
                  child
                )
              }

              previousChildStatusRef
                .current[
                child.id
              ] =
                child.safeZoneStatus ||
                'unknown'
            }
          )
        },
        (err) => {
          console.error(
            'Notification listener error:',
            err
          )
        }
      )

    return () => unsubscribe()
  }, [
    familyCode,
    role,
  ])

  /*
   * Register push notifications
   */
  useEffect(() => {
    if (
      role === 'parent' &&
      notificationPermission ===
        'granted'
    ) {
      registerForPushNotifications()
    }
  }, [
    role,
    notificationPermission,
    familyCode,
    user,
  ])

  /*
   * Cleanup location watcher
   */
  useEffect(() => {
    return () => {
      if (
        watchIdRef.current !== null
      ) {
        navigator.geolocation.clearWatch(
          watchIdRef.current
        )
      }
    }
  }, [])

  /*
   * Create account
   */
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

  /*
   * Login
   */
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

  /*
   * Google login
   */
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

  /*
   * Create family
   */
  async function createFamily() {
    if (!user) {
      return
    }

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
          parentEmail:
            user.email || '',
          safeZones: [],
          createdAt:
            serverTimestamp(),
        }
      )

      await setDoc(
        doc(
          db,
          'familyCodes',
          code
        ),
        {
          familyCode: code,
          createdAt:
            serverTimestamp(),
        }
      )

      await setDoc(
        doc(
          db,
          'users',
          user.uid
        ),
        {
          familyCode: code,
          role: 'parent',
          email:
            user.email || '',
          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      )

      setFamilyCode(code)

      setRole('parent')

      setSafeZones([])

      setFamilyData({
        id: code,
        parentId: user.uid,
        parentEmail:
          user.email || '',
        safeZones: [],
      })

      setMessage(
        'Family created successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  /*
   * Join family
   */
  async function joinFamily() {
    if (!user || !joinCode) {
      return
    }

    setError('')
    setMessage('')

    try {
      const code =
        joinCode.trim().toUpperCase()

      if (code.length !== 6) {
        setError(
          'Please enter a valid 6-character Family Code.'
        )
        return
      }

      const familyRef = doc(
        db,
        'families',
        code
      )

      const familySnapshot =
        await getDoc(familyRef)

      if (!familySnapshot.exists()) {
        setError(
          'Family code not found.'
        )
        return
      }

      const familyDataSnapshot =
        familySnapshot.data()

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
        joinedAt:
          serverTimestamp(),
      })

      await setDoc(
        doc(
          db,
          'users',
          user.uid
        ),
        {
          familyCode: code,
          role: 'child',
          email:
            user.email || '',
          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      )

      setFamilyCode(code)

      setFamilyData({
        id: code,
        ...familyDataSnapshot,
      })

      setSafeZones(
        getSafeZonesFromFamilyData(
          familyDataSnapshot
        )
      )

      setRole('child')

      setMessage(
        'You joined the family successfully.'
      )
    } catch (err) {
      console.error(
        'Join family error:',
        err
      )

      setError(err.message)
    }
  }

  /*
   * Start live location
   */
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

          if (
            now - lastSent <
            30000
          ) {
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

          const result =
            getLocationStatus(
              latitude,
              longitude,
              accuracy,
              safeZones
            )

          const status =
            result.status

          const distance =
            result.distance

          setSafeZoneStatus(
            status
          )

          setDistanceFromSafeZone(
            distance
          )

          try {
            const memberRef =
              doc(
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
                email:
                  user.email || '',
                role: 'child',
                latitude,
                longitude,
                accuracy,
                locationUpdatedAt:
                  serverTimestamp(),
                safeZoneStatus:
                  status,
                distanceFromSafeZone:
                  distance,
              },
              {
                merge: true,
              }
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
          enableHighAccuracy:
            true,
          maximumAge: 10000,
          timeout: 20000,
        }
      )

    setTracking(true)
  }

  /*
   * Stop live location
   */
  function stopLocationTracking() {
    if (
      watchIdRef.current !== null
    ) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      )

      watchIdRef.current = null
    }

    setTracking(false)

    setMessage(
      user
        ? 'Live location stopped.'
        : ''
    )
  }

  /*
   * Add Safe Zone
   */
  async function addSafeZoneAtLocation(
    position
  ) {
    if (
      !familyCode ||
      role !== 'parent'
    ) {
      return
    }

    const zoneName =
      window.prompt(
        'Enter a name for this Safe Zone:',
        `Safe Zone ${safeZones.length + 1}`
      )

    if (
      zoneName === null
    ) {
      return
    }

    const trimmedName =
      zoneName.trim()

    if (!trimmedName) {
      setError(
        'Please enter a name for the Safe Zone.'
      )
      return
    }

    try {
      const newZone = {
        id:
          `${Date.now()}-${Math.random()
            .toString(36)
            .substring(2, 8)}`,
        name: trimmedName,
        latitude:
          position.latitude,
        longitude:
          position.longitude,
        radius:
          SAFE_ZONE_RADIUS,
      }

      const currentZones =
        Array.isArray(safeZones)
          ? safeZones
          : []

      const updatedZones = [
        ...currentZones,
        newZone,
      ]

      await updateDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          safeZones:
            updatedZones,
          updatedAt:
            serverTimestamp(),
        }
      )

      setSafeZones(
        updatedZones
      )

      setMessage(
        'Safe Zone saved successfully.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  /*
   * Delete Safe Zone
   */
  async function deleteSafeZone(
    zoneId
  ) {
    if (
      !familyCode ||
      role !== 'parent'
    ) {
      return
    }

    const zone =
      safeZones.find(
        (item) =>
          item.id === zoneId
      )

    const confirmed =
      window.confirm(
        `Delete "${zone?.name || 'this Safe Zone'}"?`
      )

    if (!confirmed) {
      return
    }

    try {
      const updatedZones =
        safeZones.filter(
          (item) =>
            item.id !== zoneId
        )

      await updateDoc(
        doc(
          db,
          'families',
          familyCode
        ),
        {
          safeZones:
            updatedZones,
          updatedAt:
            serverTimestamp(),
        }
      )

      setSafeZones(
        updatedZones
      )

      setMessage(
        'Safe Zone deleted.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  /*
   * Remove child from family
   */
  async function removeChild(
    child
  ) {
    if (
      !familyCode ||
      role !== 'parent'
    ) {
      return
    }

    const confirmed =
      window.confirm(
        `Remove ${child.email || 'this child'} from the family?`
      )

    if (!confirmed) {
      return
    }

    try {
      await deleteDoc(
        doc(
          db,
          'families',
          familyCode,
          'members',
          child.id
        )
      )

      if (
        selectedChild?.id ===
        child.id
      ) {
        setSelectedChild(null)
      }

      setMessage(
        'Child removed from the family.'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  /*
   * Request browser notification permission
   */
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

      if (
        permission === 'granted'
      ) {
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

  /*
   * Register FCM push notifications
   */
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

      const token =
        await getToken(
          messagingInstance,
          {
            vapidKey:
              VAPID_KEY,
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
          parentFcmToken:
            token,
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

  /*
   * Send parent notification
   */
  async function sendParentNotification(
    child
  ) {
    try {
      const token =
        localStorage.getItem(
          'familytrack_fcm_token'
        ) ||
        familyData?.parentFcmToken

      if (!token) {
        console.log(
          'No FCM token available for parent notifications.'
        )
        return
      }

      const name =
        child.email ||
        'Your child'

      const response =
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
              title:
                'FamilyTrack Alert',
              body: `${name} has left all Safe Zones.`,
            }),
          }
        )

      const result =
        await response.json()

      if (
        !response.ok ||
        !result.success
      ) {
        console.error(
          'Notification Worker error:',
          result
        )
        return
      }

      console.log(
        'Parent notification sent successfully.'
      )
    } catch (err) {
      console.error(
        'Failed to send parent notification:',
        err
      )
    }
  }

  /*
   * Logout
   */
  async function logout() {
    stopLocationTracking()

    await signOut(auth)

    setUser(null)
    setRole(null)
    setFamilyCode('')
    setFamilyData(null)
    setSafeZones([])
    setChildren([])
    setLocation(null)
    setSelectedChild(null)
    setFcmReady(false)
    setMessage('')
    setError('')
  }

  /*
   * Loading screen
   */
  if (loading) {
    return (
      <div style={styles.centerScreen}>
        <h2>FamilyTrack</h2>
        <p>Loading...</p>
      </div>
    )
  }

  /*
   * Login screen
   */
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
            style={
              styles.primaryButton
            }
            onClick={login}
          >
            Login
          </button>

          <button
            style={
              styles.secondaryButton
            }
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
            <div
              style={
                styles.errorBox
              }
            >
              {error}
            </div>
          )}

          {message && (
            <div
              style={
                styles.successBox
              }
            >
              {message}
            </div>
          )}
        </div>
      </div>
    )
  }

  /*
   * Role selection
   */
  if (!role) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1>
            🏠 FamilyTrack
          </h1>

          <p>
            Logged in as:
            <br />
            <strong>
              {user.email}
            </strong>
          </p>

          <h2>
            Choose your role
          </h2>

          <button
            style={
              styles.primaryButton
            }
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
              setJoinCode(
                e.target.value
              )
            }
          />

          <button
            style={
              styles.secondaryButton
            }
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
            <div
              style={
                styles.errorBox
              }
            >
              {error}
            </div>
          )}

          {message && (
            <div
              style={
                styles.successBox
              }
            >
              {message}
            </div>
          )}
        </div>
      </div>
    )
  }

  /*
   * CHILD DASHBOARD
   */
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
              Safe Zones
            </strong>

            {safeZones.length === 0 ? (
              <p>
                No Safe Zones have been configured.
              </p>
            ) : (
              <ul>
                {safeZones.map(
                  (zone) => (
                    <li
                      key={
                        zone.id
                      }
                    >
                      {zone.name ||
                        'Safe Zone'}{' '}
                      —{' '}
                      {zone.radius ||
                        SAFE_ZONE_RADIUS}
                      m
                    </li>
                  )
                )}
              </ul>
            )}

            {safeZoneStatus ===
              'inside' && (
              <p
                style={
                  styles.insideText
                }
              >
                🟢 You are inside a Safe Zone.
              </p>
            )}

            {safeZoneStatus ===
              'outside' && (
              <p
                style={
                  styles.outsideText
                }
              >
                🔴 You are outside all Safe Zones.
              </p>
            )}

            {safeZoneStatus ===
              'unknown' &&
              safeZones.length > 0 && (
                <p>
                  ⚪ Location status unknown.
                </p>
              )}

            {distanceFromSafeZone !==
              null && (
              <p>
                Distance from nearest Safe Zone:{' '}
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
                  location.accuracy ||
                    0
                )}{' '}
                meters
              </p>
            </div>
          )}

          {message && (
            <div
              style={
                styles.successBox
              }
            >
              {message}
            </div>
          )}

          {error && (
            <div
              style={
                styles.errorBox
              }
            >
              {error}
            </div>
          )}
        </div>
      </div>
    )
  }

  /*
   * PARENT DASHBOARD
   */
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

            <span>
              Children
            </span>
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

          <div style={styles.statCard}>
            <strong>
              {safeZones.length}
            </strong>

            <span>
              Safe Zones
            </span>
          </div>
        </div>

        <div style={styles.infoCard}>
          <h3>
            Your Family Code
          </h3>

          <div
            style={
              styles.familyCode
            }
          >
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
            🟢 Safe Zones
          </h3>

          <p>
            Click anywhere on the map to add a new
            Safe Zone.
          </p>

          <MapContainer
            center={defaultCenter}
            zoom={12}
            scrollWheelZoom={true}
            style={styles.map}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <SafeZonePicker
              onPick={
                addSafeZoneAtLocation
              }
            />

            <MapFocus
              child={selectedChild}
            />

            {safeZones.map(
              (zone) => (
                <Circle
                  key={zone.id}
                  center={[
                    zone.latitude,
                    zone.longitude,
                  ]}
                  radius={
                    zone.radius ||
                    SAFE_ZONE_RADIUS
                  }
                >
                  <Popup>
                    <div>
                      <strong>
                        {zone.name ||
                          'Safe Zone'}
                      </strong>

                      <br />

                      Radius:{' '}
                      {zone.radius ||
                        SAFE_ZONE_RADIUS}{' '}
                      meters

                      <br />

                      <button
                        style={
                          styles.mapDangerButton
                        }
                        onClick={() =>
                          deleteSafeZone(
                            zone.id
                          )
                        }
                      >
                        Delete Safe Zone
                      </button>
                    </div>
                  </Popup>
                </Circle>
              )
            )}

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
                      <div>
                        <strong>
                          {child.email ||
                            'Child'}
                        </strong>

                        <br />

                        {child.safeZoneStatus ===
                        'outside'
                          ? '🔴 Outside all Safe Zones'
                          : child.safeZoneStatus ===
                            'inside'
                          ? '🟢 Inside a Safe Zone'
                          : '⚪ Location status unknown'}

                        <br />

                        Accuracy:{' '}
                        {Math.round(
                          child.accuracy ||
                            0
                        )}{' '}
                        meters

                        <br />

                        Distance from nearest
                        Safe Zone:{' '}
                        {typeof child.distanceFromSafeZone ===
                        'number'
                          ? `${Math.round(
                              child.distanceFromSafeZone
                            )} meters`
                          : 'Unknown'}

                        <br />

                        Last update:{' '}
                        {formatLastUpdate(
                          child.locationUpdatedAt
                        )}

                        <br />

                        <button
                          style={
                            styles.mapButton
                          }
                          onClick={() =>
                            setSelectedChild(
                              child
                            )
                          }
                        >
                          📍 Show on Map
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                )
            )}
          </MapContainer>

          <div
            style={
              styles.safeZoneList
            }
          >
            <h4>
              Saved Safe Zones
            </h4>

            {safeZones.length === 0 ? (
              <p>
                No Safe Zones yet.
              </p>
            ) : (
              safeZones.map(
                (zone, index) => (
                  <div
                    key={zone.id}
                    style={
                      styles.zoneCard
                    }
                  >
                    <div>
                      <strong>
                        {index + 1}.{' '}
                        {zone.name ||
                          'Safe Zone'}
                      </strong>

                      <div>
                        Radius:{' '}
                        {zone.radius ||
                          SAFE_ZONE_RADIUS}{' '}
                        meters
                      </div>
                    </div>

                    <button
                      style={
                        styles.smallDangerButton
                      }
                      onClick={() =>
                        deleteSafeZone(
                          zone.id
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                )
              )
            )}
          </div>
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
            children.map(
              (child) => (
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
                      🔴 Child is outside all Safe Zones
                    </p>
                  )}

                  {child.safeZoneStatus ===
                    'inside' && (
                    <p
                      style={
                        styles.insideText
                      }
                    >
                      🟢 Child is inside a Safe Zone
                    </p>
                  )}

                  {child.safeZoneStatus ===
                    'unknown' && (
                    <p>
                      ⚪ Location status unknown
                    </p>
                  )}

                  {typeof child.distanceFromSafeZone ===
                    'number' && (
                    <p>
                      Distance from nearest Safe Zone:{' '}
                      {Math.round(
                        child.distanceFromSafeZone
                      )}{' '}
                      meters
                    </p>
                  )}

                  {child.locationUpdatedAt && (
                    <p>
                      Last update:{' '}
                      {formatLastUpdate(
                        child.locationUpdatedAt
                      )}
                    </p>
                  )}

                  <div
                    style={
                      styles.childActions
                    }
                  >
                    {typeof child.latitude ===
                      'number' &&
                      typeof child.longitude ===
                        'number' && (
                        <button
                          style={
                            styles.mapButton
                          }
                          onClick={() =>
                            setSelectedChild(
                              child
                            )
                          }
                        >
                          📍 Show on Map
                        </button>
                      )}

                    <button
                      style={
                        styles.smallDangerButton
                      }
                      onClick={() =>
                        removeChild(
                          child
                        )
                      }
                    >
                      Remove Child
                    </button>
                  </div>
                </div>
              )
            )
          )}
        </div>

        {message && (
          <div
            style={
              styles.successBox
            }
          >
            {message}
          </div>
        )}

        {error && (
          <div
            style={
              styles.errorBox
            }
          >
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

        <small>
          {email}
        </small>
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

  childActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },

  mapButton: {
    marginTop: '10px',
    padding: '9px 14px',
    border: 'none',
    borderRadius: '8px',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
  },

  smallDangerButton: {
    marginTop: '10px',
    padding: '9px 14px',
    border: 'none',
    borderRadius: '8px',
    background: '#dc2626',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
  },

  mapDangerButton: {
    marginTop: '8px',
    padding: '7px 10px',
    border: 'none',
    borderRadius: '7px',
    background: '#dc2626',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
  },

  safeZoneList: {
    marginTop: '20px',
  },

  zoneCard: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    gap: '15px',
    padding: '12px',
    marginTop: '8px',
    border:
      '1px solid #e2e8f0',
    borderRadius: '10px',
  },

  insideText: {
    color: '#15803d',
    fontWeight: 'bold',
  },

  outsideText: {
    color: '#dc2626',
    fontWeight: 'bold',
  },

  map: {
    width: '100%',
    height: '450px',
    borderRadius: '12px',
    overflow: 'hidden',
  },

  mapHint: {
    color: '#64748b',
    fontSize: '14px',
  },
}
```
