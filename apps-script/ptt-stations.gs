/**
 * API ข้อมูลสถานี PTT สำหรับหน้า access-maps.html
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 * 1. เปิด Google Sheets ที่วางข้อมูล PTT ไว้ → ส่วนขยาย → Apps Script
 * 2. ลบโค้ดเดิมในไฟล์ Code.gs แล้ววางโค้ดนี้ทั้งหมด → บันทึก
 * 3. ทำให้ใช้งานได้ (Deploy) → การทำให้ใช้งานได้รายการใหม่ → ประเภท: เว็บแอป
 *    - เรียกใช้ในฐานะ: ฉัน
 *    - ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 * 4. คัดลอก URL ที่ลงท้ายด้วย /exec ส่งให้ใส่ใน maps.js (PTT_API_URL)
 *
 * แถวแรกของชีตต้องเป็นหัวคอลัมน์:
 * id, name, type, province_name, address, lat, lng, phone, products, services, card_type, ship_to, link
 * ถ้าอัปเดตข้อมูลในชีตภายหลัง ไม่ต้อง Deploy ใหม่ — เว็บจะเห็นข้อมูลใหม่ทันที
 */

const SHEET_NAME = 'PTT Stations'; // ชื่อแท็บของชีต ถ้าไม่เจอจะใช้แท็บแรก

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(h => String(h).trim());

  const rows = values
    .filter(r => r.some(v => v !== '' && v !== null))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = r[i]; });
      return o;
    });

  return ContentService
    .createTextOutput(JSON.stringify(rows))
    .setMimeType(ContentService.MimeType.JSON);
}
