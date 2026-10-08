@echo off
rem One-time installer for Content Engine on Windows. Double-click it.
rem It runs setup.ps1 (PowerShell) with this folder as the app folder.
cd /d %~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
