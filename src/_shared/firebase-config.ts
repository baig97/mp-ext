import { initializeApp } from "firebase/app";

// Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyDkYwsOL-DJotDsGdrt_Q-RVSh0jUaYJPg",
  authDomain: "lootmart-3eb04.firebaseapp.com",
  projectId: "lootmart-3eb04",
  messagingSenderId: "412085515617",
  appId: "1:412085515617:web:78c7741739d56b08428120",
  measurementId: "G-C5GG3TLTG3"
};

// Initialize Firebase app
export const app = initializeApp(firebaseConfig);

// Note: messaging will be initialized separately in different contexts
// - In service worker: use getMessaging() from firebase/messaging/sw
// - In popup/content scripts: use getMessaging() from firebase/messaging
