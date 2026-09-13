importScripts("https://www.gstatic.com/firebasejs/12.2.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.2.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCKtz9_6kCwyrh-Mhh5wD06zW_6L-64",
  authDomain: "familytrack-c42bf.firebaseapp.com",
  projectId: "familytrack-c42bf",
  storageBucket: "familytrack-c42bf.firebasestorage.app",
  messagingSenderId: "368013105130",
  appId: "1:368013105130:web:de19e4853b02d362ec4493"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};

  self.registration.showNotification(
    notification.title || "FamilyTrack",
    {
      body:
        notification.body ||
        "You have a new FamilyTrack alert."
    }
  );
});
