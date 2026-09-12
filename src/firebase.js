import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "ضع قيمة apiKey من Firebase هنا",
  authDomain: "familytrack-c42bf.firebaseapp.com",
  projectId: "familytrack-c42bf",
  storageBucket: "familytrack-c42bf.firebasestorage.app",
  messagingSenderId: "368013105130",
  appId: "ضع قيمة appId من Firebase هنا"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export default app;
