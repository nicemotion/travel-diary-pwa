@echo off
setlocal enabledelayedexpansion

rem === Travel Diary — overwrite Git.bat ===
rem Da mettere DENTRO la cartella del progetto (es. E:\Progetti\travel_diary_pwa)
rem e lanciare con doppio click. Fa: add + commit + push --force su main.

set "REMOTE_URL=https://github.com/nicemotion/travel-diary-pwa.git"

rem si posiziona sempre nella cartella dove si trova questo file, qualsiasi disco sia
cd /d "%~dp0"

rem usa "git" dal PATH se disponibile, altrimenti il percorso fisso
where git >nul 2>&1
if errorlevel 1 (
    set "GIT_EXE=D:\Git\bin\git.exe"
) else (
    set "GIT_EXE=git"
)

echo.
echo === Cartella: %cd% ===
echo.

if not exist ".git" (
    echo Nessun repository git trovato qui, lo inizializzo...
    "%GIT_EXE%" init
)

rem aggiunge il remote solo se non esiste gia'
"%GIT_EXE%" remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo Collego il remote origin...
    "%GIT_EXE%" remote add origin "%REMOTE_URL%"
)

"%GIT_EXE%" branch -M main

echo.
echo === Stato modifiche ===
"%GIT_EXE%" status
echo.

"%GIT_EXE%" add .
"%GIT_EXE%" commit -m "update %date% %time%"

echo.
echo === Push su GitHub (sovrascrive il remoto) ===
"%GIT_EXE%" push origin main --force

echo.
echo ==============================
echo Fatto. Controlla sopra che non ci siano errori in rosso.
echo ==============================
pause
