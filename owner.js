// ของที่กำลังลองทำ เห็นเฉพาะบัญชีเจ้าของ (เก็บเป็น SHA-256 ไม่ใส่อีเมลจริงในโค้ด)
// เป็นแค่การซ่อนฝั่งหน้าเว็บ — ข้อมูลจริงต้องตรวจสิทธิ์ที่ Apps Script อีกชั้น
const OWNER = "7e333d36720064279a61445480a16a08e1a52fa440b3919ae3ab46b0f4b6a958";

export async function isOwner(user) {
  const bytes = new TextEncoder().encode(String(user.email || "").trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("") === OWNER;
}
