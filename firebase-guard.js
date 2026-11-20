// ===== Firebase: ศูนย์กลางการตรวจสิทธิ์ / Logout / ตัด Session =====
// ทุกหน้าเรียกใช้จากไฟล์นี้ที่เดียว แก้ config หรือเวลาตัด session ที่นี่แล้วมีผลทุกหน้า
// Firebase ใช้เพื่อยืนยันตัวตนเท่านั้น ไม่ได้เก็บข้อมูล (ข้อมูลมาจาก Google Sheets / Apps Script)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ฟังก์ชันที่หน้าเข้าสู่ระบบ (auth.js) ต้องใช้ ส่งต่อจากที่นี่เพื่อให้ใช้ Firebase เวอร์ชันเดียวกันทุกหน้า
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7HPOhloICyxEyDTfR8yRiH2rT--q4fVo",
  authDomain: "my-login-project-26857.firebaseapp.com",
  projectId: "my-login-project-26857",
  storageBucket: "my-login-project-26857.firebasestorage.app",
  messagingSenderId: "199741800244",
  appId: "1:199741800244:web:41b413f67038c687dc2f61"
};

export const LOGIN_URL = "./index.html";
export const HUB_URL = "./Access-Hub.html";
export const INACTIVITY_LIMIT = 10 * 60 * 1000; // 10 นาที

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export async function doLogout() {
  try { await signOut(auth); }
  catch (error) { console.error("Logout Error:", error); }
  window.location.replace(LOGIN_URL);
}

let inactivityStarted = false;
function startInactivityTimer() {
  if (inactivityStarted) return;
  inactivityStarted = true;
  let timer;
  function reset() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      alert("หมดเวลาการใช้งานเนื่องจากไม่มีการเคลื่อนไหว กรุณาล็อกอินใหม่อีกครั้ง");
      await doLogout();
    }, INACTIVITY_LIMIT);
  }
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((evt) =>
    window.addEventListener(evt, reset, { passive: true })
  );
  reset();
}

/**
 * ใช้ในทุกหน้าที่ต้องล็อกอินก่อน
 * - ยังไม่ล็อกอิน: พาไปหน้าเข้าสู่ระบบ
 * - ล็อกอินแล้ว: แสดงหน้า (ใส่คลาส .ready ที่ <html>), แสดงอีเมลใน #user-email (ถ้ามี),
 *   ผูกปุ่มออกจากระบบ, เริ่มตัวจับเวลา 10 นาที แล้วเรียก onReady(user) ครั้งเดียว
 * หน้า HTML ควรมี <style>html:not(.ready) body{visibility:hidden}</style> ใน <head>
 * เพื่อซ่อนหน้าไว้จนกว่าจะยืนยันตัวตนเสร็จ
 *
 * @param {(user: import("firebase/auth").User) => void} [onReady]
 * @param {{ logoutButtonId?: string }} [options]
 */
export function requireLogin(onReady, { logoutButtonId = "logout-btn" } = {}) {
  const logoutBtn = document.getElementById(logoutButtonId);
  if (logoutBtn) logoutBtn.addEventListener("click", doLogout);

  let started = false;
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace(LOGIN_URL);
      return;
    }
    const emailEl = document.getElementById("user-email");
    if (emailEl) emailEl.textContent = user.email || "";
    document.documentElement.classList.add("ready");
    startInactivityTimer();
    if (!started) {
      started = true;
      if (onReady) onReady(user);
    }
  });
}
