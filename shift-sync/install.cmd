@echo off
rem Right-click this file and choose "Run as administrator". Keep this folder on the local disk.
net session >nul 2>&1
if errorlevel 1 (
  echo Please right-click install.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
