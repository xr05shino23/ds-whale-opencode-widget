@echo off
rem ---------------------------------------------------------------------------
rem  Manual launcher for the whale widget (double-click this file).
rem
rem  Why this exists: OpenCode's TUI only auto-loads plugins that expose a TUI
rem  entrypoint. Our plugin is a plain "side effect" plugin, so it is NOT loaded
rem  on TUI start -- "launch the TUI and the whale appears" cannot be done that
rem  way (verified on 2026-09-30). This launcher starts the widget directly.
rem
rem  This is also the *safest* route when Kaspersky (or similar) is installed:
rem  a user-initiated launch has none of the "host process spawns an unsigned
rem  binary" traits that behaviour detection looks for.
rem ---------------------------------------------------------------------------
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   [X] Electron binary not found.
  echo       Run this first:  npm install
  echo.
  pause
  exit /b 1
)

start "" "node_modules\electron\dist\electron.exe" .

echo.
echo   Whale widget started. You can close this window.
echo   (If nothing appears, check the tray icon, or run: npm run doctor)
echo.
timeout /t 3 >nul
