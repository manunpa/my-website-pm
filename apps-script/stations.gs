/**
 * API ข้อมูลปั๊มน้ำมันทุกแบรนด์ สำหรับหน้า access-maps.html
 *
 * - อ่าน "ทุกแท็บ" ในไฟล์นี้ แต่ละแท็บ = หนึ่งแบรนด์ (ชื่อแท็บจะเป็นชื่อแบรนด์บนแผนที่ เช่น PTT, PT, Shell, Caltex)
 * - ข้ามแท็บที่อยู่ใน SKIP_SHEETS และแท็บที่ชื่อขึ้นต้นด้วย _ (ใช้ทำแท็บโน้ต/สรุปได้)
 * - เพิ่มแบรนด์ใหม่: เพิ่มแท็บใหม่ แถวแรกเป็นหัวคอลัมน์ ต้องมีอย่างน้อย name, lat, lng — ไม่ต้อง Deploy ใหม่
 *
 * วิธีติดตั้ง / อัปเดตโค้ด:
 * 1. Google Sheets → ส่วนขยาย → Apps Script → ลบโค้ดเดิมใน Code.gs แล้ววางโค้ดนี้ → บันทึก
 * 2. ทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → กดดินสอ (แก้ไข) → เวอร์ชัน: เวอร์ชันใหม่ → ทำให้ใช้งานได้
 *    (วิธีนี้ URL /exec เดิมจะใช้ต่อได้ ไม่ต้องแก้เว็บ)
 */

const SKIP_SHEETS = ['All'];

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = [];

  ss.getSheets().forEach(sheet => {
    const brand = sheet.getName().trim();
    if (SKIP_SHEETS.indexOf(brand) !== -1 || brand.charAt(0) === '_' || sheet.isSheetHidden()) return;

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return;
    const headers = values.shift().map(h => String(h).trim());

    values.forEach(r => {
      if (!r.some(v => v !== '' && v !== null)) return;
      const o = { _sheet: brand };
      headers.forEach((h, i) => { if (h && r[i] !== '' && r[i] !== null) o[h] = r[i]; });
      out.push(o);
    });
  });

  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
