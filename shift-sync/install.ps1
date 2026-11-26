# Registers the "ShiftSync" task: daily 07:30 + 5 minutes after Windows signs in (also after a restart).
# For PCs that open straight to the desktop without a password. Run through install.cmd.
$ErrorActionPreference = 'Stop'

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\sync.ps1`""
$daily = New-ScheduledTaskTrigger -Daily -At '07:30'
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$logon.Delay = 'PT5M'   # wait for the network
# Runs as the signed-in user, so no password is stored and the shared drive is reachable.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
# StartWhenAvailable: run a missed 07:30 as soon as possible. Retry if the share is not reachable yet.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName 'ShiftSync' -Action $action -Trigger $daily, $logon `
    -Principal $principal -Settings $settings -Force | Out-Null

Write-Host 'Installed. Running once now...'
Start-ScheduledTask -TaskName 'ShiftSync'
Start-Sleep -Seconds 60
Write-Host "Last result: $((Get-ScheduledTaskInfo -TaskName 'ShiftSync').LastTaskResult)  (0 = OK, 267009 = still running)"
if (Test-Path -LiteralPath "$PSScriptRoot\sync.log") { Get-Content -LiteralPath "$PSScriptRoot\sync.log" -Tail 20 -Encoding UTF8 }
