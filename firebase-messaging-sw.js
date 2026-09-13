import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCKtz_9__6kCwyrh-Mhh5wD06zW_6L-64",
  authDomain: "familytrack-c42bf.firebaseapp.com",
  projectId: "familytrack-c42bf",
  storageBucket: "familytrack-c42bf.firebasestorage.app",
  messagingSenderId: "368013105130",
  appId: "1:368013105130:web:de19e4853b02d362ec4493"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const messagingSupported = isSupported();

export const messaging = messagingSupported.then((supported) => {
  if (!supported) return null;
  return getMessaging(app);
});

export default app;
