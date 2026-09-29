@echo off
setlocal
title YT Kids - Gemini Watermark Remover
cd /d "%~dp0"

echo ======================================================
echo  YT Kids - Watermark Remover and Video Stitcher
echo ======================================================
echo.

set "TARGET_FOLDER=%~1"

if "%TARGET_FOLDER%"=="" (
    set /p "TARGET_FOLDER=Enter video folder name (e.g. video1, video2) [Press Enter for latest]: "
)

:: Trim whitespace and quotes
if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER: =%"
if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER:"=%"

echo.
if "%TARGET_FOLDER%"=="" (
    echo [Processing latest detected folder...]
    echo.
    node index.mjs
) else (
    echo [Processing folder: %TARGET_FOLDER%]
    echo.
    node index.mjs "%TARGET_FOLDER%"
)

echo.
pause
