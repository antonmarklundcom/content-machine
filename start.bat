@echo off
rem Starts Content Engine on http://localhost:3000. See docs/LOCAL-SETUP.md.
rem Builds only when there is no production build yet (.next\BUILD_ID;
rem `npm run dev` creates .next without one). After `git pull`, run
rem `npm run build` once by hand.
cd /d %~dp0
if not exist .next\BUILD_ID (
  echo Building the app. This takes a minute or two...
  call npm run build || (pause & exit /b 1)
)
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3000"
call npm run start
pause
