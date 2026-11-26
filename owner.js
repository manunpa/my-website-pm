// บัญชีเจ้าของ (เก็บเป็น SHA-256 ไม่ใส่อีเมลจริงในโค้ด) และที่อยู่หลังบ้านตารางวันทำงาน
// ตรงนี้ใช้แค่จัดหน้าเว็บ — สิทธิ์ดูข้อมูลจริงตรวจที่ apps-script/shifts.gs
export const SHIFTS_URL = "https://script.google.com/macros/s/AKfycbzbv4mvsrhJuQrKXJoknD1WKC8xdLCi-K0J4i12kLoeKsAVaAYgtd5b3YDl8ermmC9MDQ/exec";
const OWNER = "7e333d36720064279a61445480a16a08e1a52fa440b3919ae3ab46b0f4b6a958";

export async function isOwner(user) {
  const bytes = new TextEncoder().encode(String(user.email || "").trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("") === OWNER;
}
