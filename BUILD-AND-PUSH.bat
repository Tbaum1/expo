@echo off
title Loot Hollow - Build and Push
cd /d "%~dp0"

echo Cleaning up any leftover git locks...
if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist ".git\config.lock" del /f /q ".git\config.lock"

echo.
echo === Step 1 of 2: baking the latest game into the app ===
call node sync-game.mjs
if errorlevel 1 goto :error

echo.
echo === Step 2 of 2: sending to GitHub (this starts the Codemagic build) ===
git add -A
git commit -m "Build %DATE% %TIME%"
git pull --no-edit -X ours
git push -u gh master
if errorlevel 1 goto :error

echo.
echo ============================================================
echo  DONE - your code is on GitHub.
echo  Now go to codemagic.io. The build starts automatically;
echo  if not, click "Start new build" (branch: master,
echo  workflow: Loot Hollow Android APK).
echo  When it finishes, the build page has the APK + install QR.
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
