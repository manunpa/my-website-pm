# Registers the "ShiftSync" task: daily 08:00 + 5 minutes after every restart, even with nobody logged on.
# Run through install.cmd. Windows asks for this account's password and stores it itself.
$ErrorActionPreference = 'Stop'

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$cred = Get-Credential -UserName $user -Message 'Windows password of this account (needed to run after a restart)'
if (-not $cred) { throw 'Cancelled.' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\sync.ps1`""
$daily = New-ScheduledTaskTrigger -Daily -At '08:00'
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = 'PT5M'   # wait for the network
# StartWhenAvailable: run a missed 08:00 as soon as the PC is back. Retry if the share is not reachable yet.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName 'ShiftSync' -Action $action -Trigger $daily, $boot -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -Force | Out-Null

Write-Host 'Installed. Running once now...'
Start-ScheduledTask -TaskName 'ShiftSync'
Start-Sleep -Seconds 60
Write-Host "Last result: $((Get-ScheduledTaskInfo -TaskName 'ShiftSync').LastTaskResult)  (0 = OK, 267009 = still running)"
if (Test-Path -LiteralPath "$PSScriptRoot\sync.log") { Get-Content -LiteralPath "$PSScriptRoot\sync.log" -Tail 20 -Encoding UTF8 }
