import {
    auth,
    HUB_URL,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    setPersistence,
    browserLocalPersistence,
    markLogin,
    isSessionStale,
    endSession
} from "./firebase-guard.js?v=20261122-cut";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const messageBox = document.getElementById("message");
const submitBtn = document.getElementById("submit-btn");
const resetBtn = document.getElementById("reset-btn");
const toggleBtn = document.getElementById("toggle-password");

function showMessage(text, type = "error") {
    messageBox.textContent = text;
    messageBox.className = "text-sm rounded-lg px-3 py-2 " +
        (type === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700");
}

function clearMessage() {
    messageBox.className = "hidden";
    messageBox.textContent = "";
}

function errorText(code) {
    switch (code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found": return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
        case "auth/invalid-email": return "รูปแบบอีเมลไม่ถูกต้อง";
        case "auth/user-disabled": return "บัญชีนี้ถูกระงับการใช้งาน";
        case "auth/too-many-requests": return "พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่";
        case "auth/network-request-failed": return "เชื่อมต่อเครือข่ายไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต";
        case "auth/unauthorized-domain": return "โดเมนนี้ยังไม่ได้เพิ่มใน Firebase (Authorized domains)";
        case "auth/operation-not-allowed": return "ยังไม่ได้เปิดใช้ Email/Password ใน Firebase";
        default: return "เกิดข้อผิดพลาด: " + code;
    }
}

// Firebase เป็นแหล่งความจริงเดียว
let loggingIn = false;
onAuthStateChanged(auth, async (user) => {
    if (user && !loggingIn && isSessionStale()) {
        // ล็อกอินค้างไว้จากครั้งก่อน แต่ไม่ได้ใช้งานนานเกินกำหนด → ให้ล็อกอินใหม่
        await endSession();
        return; // onAuthStateChanged จะถูกเรียกอีกครั้งด้วย user = null แล้วแสดงฟอร์ม
    }
    if (user) {
        window.location.replace(HUB_URL);
    } else {
        document.body.style.visibility = "visible";
    }
});

toggleBtn.addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    toggleBtn.textContent = show ? "ซ่อน" : "แสดง";
});

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessage();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
        showMessage("กรุณากรอกอีเมลและรหัสผ่าน");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "กำลังเข้าสู่ระบบ...";
    try {
        loggingIn = true;
        markLogin(); // จดเวลาล็อกอิน (ใช้ตัดรอบ 00:00 / 06:00) และเริ่มนับเวลาใช้งานใหม่
        await setPersistence(auth, browserLocalPersistence);
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged จะพาไปหน้า Hub ให้เอง
    } catch (error) {
        console.error("Login error:", error.code, error.message);
        loggingIn = false;
        showMessage(errorText(error.code));
        submitBtn.disabled = false;
        submitBtn.textContent = "เข้าสู่ระบบ";
    }
});

resetBtn.addEventListener("click", async () => {
    clearMessage();
    const email = emailInput.value.trim();
    if (!email) {
        showMessage("กรอกอีเมลก่อน แล้วกด “ลืมรหัสผ่าน?” อีกครั้ง");
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        showMessage("ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลแล้ว (ตรวจสอบในกล่องสแปมด้วย)", "success");
    } catch (error) {
        console.error("Reset error:", error.code, error.message);
        showMessage(errorText(error.code));
    }
});