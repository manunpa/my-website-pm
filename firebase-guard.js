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
export const INACTIVITY_LIMIT = 1 * 60 * 60 * 1000; // 1 ชั่วโมง (ไม่มีการใช้งานครบเวลานี้ → ออกจากระบบ)

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ===== เวลาใช้งานล่าสุด (จำในเครื่องนี้) =====
// Firebase จำการล็อกอินไว้ในเบราว์เซอร์ตลอด ปิดแท็บแล้วเปิดใหม่ก็ยังเข้าได้
// จึงจดเวลาที่ใช้งานล่าสุดไว้ ถ้าเปิดมาใหม่แล้วห่างเกิน INACTIVITY_LIMIT → ให้ล็อกอินใหม่
const LAST_ACTIVE_KEY = "hub-last-active";

export function markActive() {
  try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch {}
}

/** true = ไม่ได้ใช้งานนานเกินกำหนด (หรือไม่เคยจดเวลาไว้) ต้องล็อกอินใหม่ */
export function isSessionStale() {
  let last;
  try { last = Number(localStorage.getItem(LAST_ACTIVE_KEY)); }
  catch { return false; } // เบราว์เซอร์บล็อกที่เก็บข้อมูล → ตรวจไม่ได้ ใช้ตัวจับเวลาในหน้าแทน
  return !last || Date.now() - last > INACTIVITY_LIMIT;
}

/** ออกจากระบบและลบข้อมูลที่จำไว้ โดยไม่เปลี่ยนหน้า */
export async function endSession() {
  try { await signOut(auth); }
  catch (error) { console.error("Logout Error:", error); }
  try { localStorage.removeItem(LAST_ACTIVE_KEY); } catch {}
  // ลบข้อมูลแผนที่ที่จำไว้ในเครื่อง (maps.js) — คนถัดไปที่ใช้เครื่องนี้จะไม่เห็นข้อมูลถ้ายังไม่ล็อกอิน
  try { if (window.caches) await caches.delete("access-maps-data-v1"); } catch {}
}

export async function doLogout() {
  await endSession();
  window.location.replace(LOGIN_URL);
}

/**
 * ดึงข้อมูลจาก Apps Script โดยแนบ Firebase ID token ไปด้วย (ฝั่ง Apps Script ตรวจใน apps-script/stations.gs)
 * - ส่งเป็น POST แบบ text/plain → token อยู่ใน body ไม่อยู่ใน URL และไม่ต้องผ่าน CORS preflight
 * - Apps Script ตอบ {status:"error", error:"unauthorized"} ถ้า token ใช้ไม่ได้ → ขอ token ใหม่แล้วลองอีกครั้งเดียว
 * @param {string} url  URL /exec ของ Apps Script
 * @returns {Promise<string>} ข้อความ JSON ที่ได้
 */
export async function fetchProtectedText(url) {
  const user = auth.currentUser;
  if (!user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  for (let attempt = 0; attempt < 2; attempt++) {
    const idToken = await user.getIdToken(attempt > 0);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ idToken }),
      redirect: "follow",
      cache: "no-store"
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const err = apiError(text);
    if (!err) return text;
    if (err.error === "unauthorized" && attempt === 0) continue;
    throw new Error(err.message || err.error || "เกิดข้อผิดพลาดจาก API");
  }
}

// ข้อความตอบกลับแบบผิดพลาดเป็น object สั้นๆ เสมอ — ไม่ต้อง parse ข้อมูลก้อนใหญ่ซ้ำ
function apiError(text) {
  if (text.length > 2000 || text.charAt(0) !== "{") return null;
  try {
    const j = JSON.parse(text);
    return j && j.status === "error" && j.error ? j : null;
  } catch { return null; }
}

let inactivityStarted = false;
function startInactivityTimer() {
  if (inactivityStarted) return;
  inactivityStarted = true;
  let timer;
  let lastWrite = 0;
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      // อีกแท็บอาจยังใช้งานอยู่ (เวลาล่าสุดใช้ร่วมกันทุกแท็บ) → นับต่อ ไม่ต้องออก
      if (!isSessionStale()) { schedule(INACTIVITY_LIMIT); return; }
      alert("หมดเวลาการใช้งานเนื่องจากไม่มีการเคลื่อนไหว กรุณาล็อกอินใหม่อีกครั้ง");
      await doLogout();
    }, delay);
  }
  function reset() {
    const now = Date.now();
    if (now - lastWrite > 30000) { lastWrite = now; markActive(); } // จดไม่เกินทุก 30 วินาที
    schedule(INACTIVITY_LIMIT);
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
 *   ผูกปุ่มออกจากระบบ, เริ่มตัวจับเวลา (INACTIVITY_LIMIT) แล้วเรียก onReady(user) ครั้งเดียว
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
    // เปิดหน้าใหม่หลังไม่ได้ใช้งานนานเกินกำหนด → ออกจากระบบ ให้ล็อกอินใหม่
    if (!started && isSessionStale()) {
      doLogout();
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
