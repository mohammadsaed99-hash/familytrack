import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
   apiKey: "AIzaSyCKtz_9__6kCwyrh-Mhh5wD06zW_6_L-64",
  projectId: "familytrack-c42bf",
  storageBucket: "familytrack-c42bf.firebasestorage.app",
  messagingSenderId: "368013105130",
  appId: "1:368013105130:web:de19e4853b02d362ec4493"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export default app;
