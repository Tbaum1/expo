@echo off
title Loot Hollow - Build and Push
cd /d "%~dp0"

REM --- Make sure Git and Node are reachable even if they're not on the system PATH.
REM     (Add your own folder here if yours is installed somewhere else.)
set "PATH=%PATH%;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\nodejs"

echo Cleaning up any leftover git locks...
if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist ".git\config.lock" del /f /q ".git\config.lock"

echo.
echo Checking tools...
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo *** Git was not found. ***
  echo Install it from https://git-scm.com , then run this again.
  goto :error
)

echo.
echo === Step 1 of 2: baking the latest game into the app ===
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo NOTE: Node was not found, so this run will NOT re-bake the game.
  echo       It will push the gameHtml.js that is already in this folder.
  echo       That's fine right now -- Claude already baked the current version.
  echo       If you EDIT the game later, install Node from https://nodejs.org
  echo       so this script can re-bake your changes.
  echo.
) else (
  call node sync-game.mjs
  if errorlevel 1 goto :error
)

REM --- Safety net: never ship a truncated bundle (this was the blank-screen bug). ---
findstr /C:"</html>" gameHtml.js >nul
if errorlevel 1 (
  echo.
  echo *** SAFETY STOP: gameHtml.js looks truncated -- no closing tag found. ***
  echo Nothing was pushed. Send this message to Claude.
  goto :error
)
echo Bundle looks complete.

echo.
echo === Step 2 of 2: sending to GitHub ===
git add -A
git commit -m "Build %DATE% %TIME%"
git pull --no-edit -X ours
git push -u gh master
if errorlevel 1 goto :error

echo.
echo ============================================================
echo  DONE - your code is on GitHub.
echo.
echo  NEXT: go to codemagic.io and click "Start new build"
echo        (branch: master, workflow: Loot Hollow Android APK).
echo        When it finishes, that page has the APK + install QR.
echo ============================================================
echo.
pause
exit /b 0

:error
echo.
echo *** Something went wrong above. ***
echo Copy the red/error text and send it to Claude.
echo.
pause
exit /b 1
