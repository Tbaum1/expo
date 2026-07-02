@echo off
title Loot Hollow - iOS Cloud Build (EAS)
cd /d "%~dp0"

REM --- Make sure Node/npm are reachable even if not on the system PATH. ---
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\nodejs"

echo ============================================================
echo   Loot Hollow - iOS build in the cloud (no Mac needed)
echo ============================================================
echo.
echo This uses EAS (Expo's cloud build service). It will:
echo   1. Upload this project to Expo's servers
echo   2. Ask you to log in to your Apple account (first time only)
echo   3. Auto-create your iOS certificate + provisioning profile
echo   4. Build the .ipa in the cloud
echo.
echo When it asks to log in to Apple, use:
echo   Apple ID: anthony.tennenbaum@yahoo.com
echo   (and approve the 2-factor code on your phone)
echo.
pause

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo *** Node was not found. Install it from https://nodejs.org then run this again. ***
  goto :error
)

echo.
echo === Step 1 of 2: building the iOS app (this takes ~15-25 min) ===
call npx eas-cli@latest build --platform ios --profile production
if errorlevel 1 goto :error

echo.
echo === Step 2 of 2: uploading the build to App Store Connect ===
echo Press a key to send the finished build to Apple (TestFlight / App Store).
pause
call npx eas-cli@latest submit --platform ios --profile production --latest
if errorlevel 1 goto :error

echo.
echo ============================================================
echo  DONE - your iOS build is on App Store Connect.
echo  Next: in App Store Connect, attach the build to version 1.0
echo  and (when you're ready) click "Add for Review".
echo ============================================================
echo.
pause
goto :eof

:error
echo.
echo *** Something went wrong. Copy the last lines above and send them to Claude. ***
echo.
pause
