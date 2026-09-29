@echo off
setlocal
title YT Kids - Video Processing Pipeline
cd /d "%~dp0"

echo ======================================================
echo  YT Kids - Video Processing Pipeline
echo ======================================================
echo.
echo Select Mode:
echo   [1] Video Joiner Only (Fast, Lossless - NO watermark removal)
echo   [2] Video Joiner + Logo Remover (Join clips first -^> Remove watermark -^> Add channel intro)
echo.

set "MODE_CHOICE=2"
set /p "MODE_CHOICE=Enter choice [1 or 2, default: 2]: "

:: Trim whitespace and quotes from MODE_CHOICE
if defined MODE_CHOICE set "MODE_CHOICE=%MODE_CHOICE: =%"
if defined MODE_CHOICE set "MODE_CHOICE=%MODE_CHOICE:"=%"

echo.
set "TARGET_FOLDER=%~1"

if "%TARGET_FOLDER%"=="" (
    set /p "TARGET_FOLDER=Enter video folder name (e.g. video1, video2) [Press Enter for latest]: "
)

:: Trim whitespace and quotes from TARGET_FOLDER
if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER: =%"
if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER:"=%"

set "MODE_FLAG="
if "%MODE_CHOICE%"=="1" (
    set "MODE_FLAG=--join-only"
    echo.
    echo [Selected: Mode 1 - Video Joiner Only]
) else (
    echo.
    echo [Selected: Mode 2 - Video Joiner + Logo Remover - Join first, then Remove]
)

echo.
if "%TARGET_FOLDER%"=="" (
    echo [Processing latest detected folder...]
    echo.
    node index.mjs %MODE_FLAG%
) else (
    echo [Processing folder: %TARGET_FOLDER%]
    echo.
    node index.mjs "%TARGET_FOLDER%" %MODE_FLAG%
)

echo.
pause
