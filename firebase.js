import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "الصق apiKey هنا",
  authDomain: "الصق authDomain هنا",
  projectId: "الصق projectId هنا",
  storageBucket: "الصق storageBucket هنا",
  messagingSenderId: "الصق messagingSenderId هنا",
  appId: "الصق appId هنا"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export default app;
