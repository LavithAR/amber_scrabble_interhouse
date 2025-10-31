@echo off
title AMBER SCRABBLE INTERHOUSE v3 - Start (Local test)
node -v >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install LTS from https://nodejs.org
  pause
  exit /b
)
echo Installing server deps...
npm install --no-audit --no-fund
echo Installing client deps and building...
cd client
npm install --no-audit --no-fund
npm run build || echo "Client build failed - run 'npm run dev' inside client"
cd ..
start cmd /k "node server.js"
echo Server started. Open http://localhost:3000/admin
pause