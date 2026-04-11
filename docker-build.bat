@echo off
echo [1/4] Stopping containers...
docker compose down

echo [2/4] Building with Maven...
call mvn package -DskipTests
if %ERRORLEVEL% neq 0 (
    echo Maven build failed.
    exit /b %ERRORLEVEL%
)

echo [2/4] Copying Jar...
copy .\target\gridlockdm-0.1.0-SNAPSHOT.jar gridlockdm.jar

echo [4/4] Starting containers...
docker compose up -d --build

echo Done.

REM docker compose logs -f -t
