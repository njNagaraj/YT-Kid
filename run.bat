@echo off
setlocal
cd /d "%~dp0"
title YT Video Processing Pipeline

echo ======================================================
echo    YT Video Processing Pipeline (Joiner + Cleaner)
echo ======================================================
echo.
echo Select Mode:
echo   [1] Video Joiner Only (Instant Lossless Stitch - NO watermark removal)
echo   [2] Video Joiner + Logo Remover (Join first -^> Clean once -^> Prepend intro) [DEFAULT]
echo   [3] Clean Clip-by-Clip (Parallel Workers) + Lossless Join
echo   [4] Verify Files ^& Generate Report
echo.

set "MODE_CHOICE=2"
set /p "MODE_CHOICE=Enter choice [1-4, default: 2]: "

if defined MODE_CHOICE set "MODE_CHOICE=%MODE_CHOICE: =%"
if defined MODE_CHOICE set "MODE_CHOICE=%MODE_CHOICE:"=%"

echo.
set "TARGET_FOLDER=%~1"

if "%TARGET_FOLDER%"=="" (
    set /p "TARGET_FOLDER=Enter video folder name (e.g. video1, video2) [Press Enter for latest]: "
)

if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER: =%"
if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER:"=%"

set "MODE_FLAG=full"
if "%MODE_CHOICE%"=="1" (
    set "MODE_FLAG=join"
) else if "%MODE_CHOICE%"=="3" (
    set "MODE_FLAG=clean --workers 2"
) else if "%MODE_CHOICE%"=="4" (
    set "MODE_FLAG=verify"
) else (
    set "MODE_FLAG=full"
)

echo.
if "%TARGET_FOLDER%"=="" (
    echo [Processing latest detected video folder with mode: %MODE_FLAG%...]
    echo.
    node index.mjs %MODE_FLAG%
) else (
    echo [Processing folder: %TARGET_FOLDER% with mode: %MODE_FLAG%...]
    echo.
    node index.mjs %MODE_FLAG% -i "%TARGET_FOLDER%"
)

echo.
pause
