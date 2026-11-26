# อ่านตารางกะจากไดรฟ์แชร์ (อ่านอย่างเดียว) แล้วส่งเดือนที่เปลี่ยนไปที่ apps-script/shifts.gs
# ตั้งค่าใน config.json ข้างไฟล์นี้ (ดู config.example.json)
#   powershell -ExecutionPolicy Bypass -File sync.ps1 -DryRun   ดูว่าจะส่งอะไร ไม่ส่งจริง
param([switch]$DryRun, [string]$Config = "$PSScriptRoot\config.json")

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$stateFile = "$PSScriptRoot\state.json"
$logFile = "$PSScriptRoot\sync.log"
$months = 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
# ไฟล์สำรอง/ฉบับเก่า/ไฟล์ล็อกของ Excel ไม่เอา
$skip = '^~\$|^T |BK|back ?up|สำรอง|เก่า|Copy of|สำเนา'

function Write-Log($text) {
    $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $text
    Write-Host $line
    if (-not $DryRun) { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 }
}

function Get-Xml($zip, $name) {
    $entry = $zip.GetEntry($name)
    if (-not $entry) { return $null }
    $reader = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
    try { $doc = New-Object Xml.XmlDocument; $doc.PreserveWhitespace = $true; $doc.LoadXml($reader.ReadToEnd()); $doc }
    finally { $reader.Dispose() }
}

# ข้อความในเซลล์ (รวมหลายรูปแบบอักษร ไม่เอาคำอ่าน rPh)
function Get-Text($node) {
    -join ($node.SelectNodes("*[local-name()='t'] | *[local-name()='r']/*[local-name()='t']") | ForEach-Object { $_.InnerText })
}

# แถวของชีต: hashtable เลขแถว -> hashtable เลขคอลัมน์ (เริ่ม 0) -> ข้อความ
function Read-Sheet($zip, $path, $shared) {
    $rows = @{}
    foreach ($c in (Get-Xml $zip $path).SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']/*[local-name()='c']")) {
        if ($c.GetAttribute('r') -notmatch '^([A-Z]+)(\d+)$') { continue }
        $col = 0
        foreach ($ch in $matches[1].ToCharArray()) { $col = $col * 26 + ([int]$ch - 64) }
        $row = [int]$matches[2]
        $type = $c.GetAttribute('t')
        if ($type -eq 'inlineStr') { $value = Get-Text $c.SelectSingleNode("*[local-name()='is']") }
        else {
            $v = $c.SelectSingleNode("*[local-name()='v']")
            if (-not $v) { continue }
            $value = if ($type -eq 's') { $shared[[int]$v.InnerText] } else { $v.InnerText }
        }
        if (-not $rows.ContainsKey($row)) { $rows[$row] = @{} }
        $rows[$row][$col - 1] = [string]$value
    }
    $rows
}

function Get-Cell($rows, $r, $c) {
    if ($rows.ContainsKey($r) -and $rows[$r].ContainsKey($c)) { $rows[$r][$c].Trim() } else { '' }
}

# ต้องให้ผลเหมือน parse() ใน shifts.html ไม่งั้นอัปมือกับสคริปต์จะเห็นเป็นการเปลี่ยนแปลง
function Read-Schedule($file) {
    # เปิดแบบยอมให้คนอื่นแก้ไฟล์ต่อได้ แล้วอ่านเข้าหน่วยความจำ
    $stream = [IO.File]::Open($file, 'Open', 'Read', 'ReadWrite, Delete')
    try { $memory = New-Object IO.MemoryStream; $stream.CopyTo($memory) } finally { $stream.Dispose() }
    $zip = New-Object IO.Compression.ZipArchive($memory, [IO.Compression.ZipArchiveMode]::Read)
    try {
        $shared = @()
        $sst = Get-Xml $zip 'xl/sharedStrings.xml'
        if ($sst) { $shared = @($sst.SelectNodes("/*/*[local-name()='si']") | ForEach-Object { Get-Text $_ }) }
        $targets = @{}
        foreach ($rel in (Get-Xml $zip 'xl/_rels/workbook.xml.rels').DocumentElement.ChildNodes) {
            if ($rel.Id) { $targets[$rel.Id] = 'xl/' + ($rel.Target -replace '^/?(xl/)?', '') }
        }
        $sheets = @((Get-Xml $zip 'xl/workbook.xml').SelectNodes("//*[local-name()='sheets']/*[local-name()='sheet']") |
            Where-Object { $_.GetAttribute('state') -notmatch 'hidden' })
        [array]::Reverse($sheets)
        foreach ($sheet in $sheets) {
            $id = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
            $rows = Read-Sheet $zip $targets[$id] $shared
            $numbers = @($rows.Keys | Sort-Object)
            $head = $numbers | Where-Object { (Get-Cell $rows $_ 0) -eq 'ลำดับ' } | Select-Object -First 1
            if (-not $head) { continue }
            $last = ($rows[$head].Keys | Measure-Object -Maximum).Maximum
            $end = 0..$last | Where-Object { (Get-Cell $rows $head $_).Contains('จำนวนวันทำงาน') } | Select-Object -First 1
            if (-not $end) { $end = $last + 1 }
            $cols = @(4..($end - 1) | Where-Object { (Get-Cell $rows $head $_) -match '^([1-9]|[12]\d|3[01])$' })
            if (-not $cols.Count) { continue }
            $people = New-Object Collections.ArrayList
            foreach ($r in ($numbers | Where-Object { $_ -ge $head + 2 })) {
                if ((Get-Cell $rows $r 0) -ceq 'D') { break }
                $name = Get-Cell $rows $r 2
                if (-not $name) { continue }
                $code = Get-Cell $rows $r 1
                if (-not $code) { $code = $name }
                [void]$people.Add([ordered]@{
                    id = $code; name = $name; group = (Get-Cell $rows $r 3)
                    codes = @($cols | ForEach-Object { Get-Cell $rows $r $_ })
                })
            }
            $title = $sheet.GetAttribute('name')
            :find foreach ($r in ($numbers | Where-Object { $_ -lt $head })) {
                foreach ($c in ($rows[$r].Keys | Sort-Object)) {
                    if ($rows[$r][$c].Contains('ตาราง')) { $title = $rows[$r][$c]; break find }
                }
            }
            return [ordered]@{
                title = $title.Trim()
                days  = @($cols | ForEach-Object { [int](Get-Cell $rows $head $_) })
                week  = @($cols | ForEach-Object { Get-Cell $rows ($head + 1) $_ })
                people = @($people)
            }
        }
        throw 'ไม่พบหัวตาราง "ลำดับ"'
    }
    finally { $zip.Dispose() }
}

# หัวตาราง เช่น "...ประจำเดือน ธันวาคม 2569 ..." -> m2569-12
function Get-Key($title) {
    $m = 0..11 | Where-Object { $title.Contains($months[$_]) } | Select-Object -First 1
    if ($null -eq $m -or $title -notmatch ($months[$m] + '\s*(?:25)?(\d\d)(?!\d)')) { return $null }
    'm25{0}-{1:00}' -f $matches[1], ($m + 1)
}

if (-not (Test-Path -LiteralPath $cfg.Root)) { Write-Log "เข้าโฟลเดอร์ไม่ได้: $($cfg.Root)"; exit 1 }

# ไฟล์ล่าสุดของแต่ละโฟลเดอร์เดือน (<ปี>\<เดือน>\*.xlsx)
$files = Get-ChildItem -LiteralPath $cfg.Root -Directory |
    Where-Object { $_.Name -match '^25\d\d$' -and [int]$_.Name -ge $cfg.MinYear } |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory } |
    ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -File -Filter *.xlsx |
            Where-Object { $_.Name -like '*ตารางงาน*' -and $_.Name -notmatch $skip } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    } | Sort-Object LastWriteTime -Descending

$state = @{}
if (Test-Path -LiteralPath $stateFile) {
    (Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $state[$_.Name] = $_.Value }
}

$seen = @{}
$failed = 0
foreach ($file in $files) {
    $stamp = "$($file.LastWriteTimeUtc.Ticks)"
    $known = $state[$file.FullName]
    # ไฟล์ใหม่กว่ามาก่อน เดือนเดียวกันที่เจอซ้ำจึงข้าม
    if ($known -and $known.stamp -eq $stamp -and -not $DryRun) { $seen[$known.key] = $true; continue }
    try {
        $data = Read-Schedule $file.FullName
        $key = Get-Key $data.title
        if (-not $key) { throw "หัวตารางไม่บอกเดือนและปี: $($data.title)" }
        if ($seen[$key]) { continue }
        $seen[$key] = $true
        if ($DryRun) {
            Write-Log ("{0}  {1} คน {2} วัน  {3}" -f $key, $data.people.Count, $data.days.Count, $file.Name)
            continue
        }
        $body = @{ action = 'sync'; syncKey = $cfg.Key; key = $key; data = $data } | ConvertTo-Json -Depth 6 -Compress
        $res = Invoke-RestMethod -Uri $cfg.Url -Method Post -ContentType 'text/plain;charset=utf-8' `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60
        if ($res.status -ne 'success') { throw "เซิร์ฟเวอร์ตอบ: $($res.message)" }
        $state[$file.FullName] = @{ stamp = $stamp; key = $key }
        $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
        Write-Log "$key  ส่งแล้ว ($($res.changes) รายการเปลี่ยน)  $($file.Name)"
    }
    catch {
        $failed++
        Write-Log "ผิดพลาด $($file.Name): $($_.Exception.Message)"
    }
}
if ($failed) { exit 1 }
