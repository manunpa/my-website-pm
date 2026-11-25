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
const LOGIN_AT_KEY = "hub-login-at";

// ===== ตัดรอบบังคับออกจากระบบทุกวัน (เวลาไทย) =====
// ล็อกอินก่อนเวลาตัดรอบ → พอถึงเวลาตัดรอบต้องล็อกอินใหม่ ไม่ว่าจะใช้งานอยู่หรือไม่
export const CUTOFF_HOURS = [0, 6]; // 00:00 และ 06:00 น.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TH_OFFSET = 7 * HOUR; // เวลาไทย UTC+7 (ไม่มีปรับเวลาฤดูร้อน) ไม่ขึ้นกับโซนเวลาของเครื่อง

/** เวลาตัดรอบล่าสุดที่ผ่านมาแล้ว (ms) */
function lastCutoff(now = Date.now()) {
  const th = now + TH_OFFSET;
  const dayStart = Math.floor(th / DAY) * DAY;
  const hours = [...CUTOFF_HOURS].sort((a, b) => b - a);
  for (const h of hours) {
    if (th >= dayStart + h * HOUR) return dayStart + h * HOUR - TH_OFFSET;
  }
  return dayStart - DAY + hours[0] * HOUR - TH_OFFSET; // รอบสุดท้ายของเมื่อวาน
}

/** เวลาตัดรอบถัดไป (ms) */
function nextCutoff(now = Date.now()) {
  const th = now + TH_OFFSET;
  const dayStart = Math.floor(th / DAY) * DAY;
  const hours = [...CUTOFF_HOURS].sort((a, b) => a - b);
  for (const h of hours) {
    if (th < dayStart + h * HOUR) return dayStart + h * HOUR - TH_OFFSET;
  }
  return dayStart + DAY + hours[0] * HOUR - TH_OFFSET; // รอบแรกของพรุ่งนี้
}

export function markActive() {
  try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch {}
}

/** เรียกตอนกดเข้าสู่ระบบ: จดเวลาล็อกอิน + เวลาใช้งานล่าสุด */
export function markLogin() {
  try { localStorage.setItem(LOGIN_AT_KEY, String(Date.now())); } catch {}
  markActive();
}

/**
 * เหตุที่ต้องล็อกอินใหม่: "cutoff" = ผ่านเวลาตัดรอบมาแล้วหลังล็อกอิน,
 * "idle" = ไม่ได้ใช้งานนานเกินกำหนด, null = ยังใช้ได้
 * ไม่เคยจดเวลาไว้ (ล็อกอินจากเวอร์ชันเก่า) ถือว่าต้องล็อกอินใหม่
 */
export function sessionEndReason() {
  let loginAt, last;
  try {
    loginAt = Number(localStorage.getItem(LOGIN_AT_KEY));
    last = Number(localStorage.getItem(LAST_ACTIVE_KEY));
  } catch { return null; } // เบราว์เซอร์บล็อกที่เก็บข้อมูล → ตรวจไม่ได้ ใช้ตัวจับเวลาในหน้าแทน
  const now = Date.now();
  if (!loginAt || loginAt < lastCutoff(now)) return "cutoff";
  if (!last || now - last > INACTIVITY_LIMIT) return "idle";
  return null;
}

export function isSessionStale() {
  return sessionEndReason() !== null;
}

/** ออกจากระบบและลบข้อมูลที่จำไว้ โดยไม่เปลี่ยนหน้า */
export async function endSession() {
  try { await signOut(auth); }
  catch (error) { console.error("Logout Error:", error); }
  try { localStorage.removeItem(LAST_ACTIVE_KEY); localStorage.removeItem(LOGIN_AT_KEY); } catch {}
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
 * @param {object} [extra]  ค่าอื่นที่ส่งไปพร้อม token (เช่น {kind:'map'} ของตัวนับโควตา Google Maps)
 * @returns {Promise<string>} ข้อความ JSON ที่ได้
 */
export async function fetchProtectedText(url, extra = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  for (let attempt = 0; attempt < 2; attempt++) {
    const idToken = await user.getIdToken(attempt > 0);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...extra, idToken }),
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
  let leaving = false;
  async function expire(reason) {
    if (leaving) return;
    leaving = true;
    alert(reason === "cutoff"
      ? "ถึงเวลาตัดรอบ (00:00 / 06:00 น.) ระบบออกจากระบบอัตโนมัติ กรุณาล็อกอินใหม่อีกครั้ง"
      : "หมดเวลาการใช้งานเนื่องจากไม่มีการเคลื่อนไหว กรุณาล็อกอินใหม่อีกครั้ง");
    await doLogout();
  }
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // อีกแท็บอาจยังใช้งานอยู่ (เวลาล่าสุดใช้ร่วมกันทุกแท็บ) → นับต่อ ไม่ต้องออก
      const reason = sessionEndReason();
      if (!reason) { schedule(INACTIVITY_LIMIT); return; }
      expire(reason);
    }, delay);
  }
  // ตัดรอบ 00:00 / 06:00: ตั้งเวลาไว้ตอนถึงรอบถัดไป (เลยไป 1 วินาทีกันคลาดเคลื่อน)
  (function scheduleCutoff() {
    setTimeout(() => {
      const reason = sessionEndReason();
      if (reason) expire(reason); else scheduleCutoff();
    }, nextCutoff() - Date.now() + 1000);
  })();
  // เครื่องหลับ / สลับแอปนานๆ ตัวจับเวลาอาจไม่ทำงาน → เช็กอีกครั้งตอนกลับมาที่หน้า
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const reason = sessionEndReason();
    if (reason) expire(reason);
  });
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

// ===== บอกว่าเครื่องนี้กำลังใช้หน้าไหน (นับในห้อง room.html — apps-script/presence.gs) =====
// ว่างไว้ = ปิดการนับ ส่งเฉพาะ รหัสสุ่มของเครื่อง ชื่อหน้า ชนิดเครื่อง และเฉพาะตอนหน้าจอแสดงอยู่
export const PRESENCE_URL = "https://script.google.com/macros/s/AKfycbyI3ANPrxYuw6acXDml5d4Ks5yLD2MlW3RSX_9_Z4ogkW0ZYGgHwR7Hjl2UlMx8_uuu-A/exec";
const PRESENCE_MS = 60 * 1000;

function startPresence() {
  const page = (location.pathname.split("/").pop() || "index").replace(/\.html$/, "");
  if (!PRESENCE_URL || page === "room") return;
  let device;
  try {
    device = localStorage.getItem("hub-device") || Math.random().toString(36).slice(2, 12);
    localStorage.setItem("hub-device", device);
  } catch { device = Math.random().toString(36).slice(2, 12); }
  const ua = navigator.userAgent;
  const kind = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "แท็บเล็ต"
    : /Mobi|Android|iPhone/i.test(ua) ? "มือถือ" : "คอม";
  const os = kind !== "คอม" && /Macintosh|iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Other";
  const browser = /Line\//.test(ua) ? "LINE" : /Edg/.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung"
    : /OPR/.test(ua) ? "Opera" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome"
    : /Safari/.test(ua) ? "Safari" : "Other";
  const ping = () => {
    if (document.visibilityState !== "visible" || !auth.currentUser) return;
    fetchProtectedText(PRESENCE_URL, { action: "ping", device, page, kind, os, browser }).catch(() => {});
  };
  ping();
  setInterval(ping, PRESENCE_MS);
  document.addEventListener("visibilitychange", ping);
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
    // เปิดหน้าใหม่หลังไม่ได้ใช้งานนานเกินกำหนด หรือผ่านเวลาตัดรอบมาแล้ว → ออกจากระบบ ให้ล็อกอินใหม่
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
      startPresence();
      if (onReady) onReady(user);
    }
  });
}
