# --- CONFIGURATION ---
$ProjectDir = Get-Location
$EnvFile = "$ProjectDir\backend\.env"
$FrontendPort = 8081

# 1. READ BACKEND PORT FROM .ENV
if (Test-Path $EnvFile) {
    $envContent = Get-Content $EnvFile
    $SERVER_PORT = ($envContent | Select-String "SERVER_PORT=(\d+)").Matches.Groups[1].Value
}
if (-not $SERVER_PORT) { $SERVER_PORT = 40811 }

Write-Host "--- CLEANUP ---" -ForegroundColor Cyan
Write-Host "Killing Backend (Port $SERVER_PORT) and Frontend (Port $FrontendPort)..."

# 2. KILL PROCESSES (Prevent 'Address in use' errors)
# Kill Backend Port
$BackendProcess = Get-NetTCPConnection -LocalPort $SERVER_PORT -ErrorAction SilentlyContinue
if ($BackendProcess) {
    Stop-Process -Id $BackendProcess.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Killed Backend (Port $SERVER_PORT)" -ForegroundColor Yellow
}
# Kill Frontend Port
$FrontendProcess = Get-NetTCPConnection -LocalPort $FrontendPort -ErrorAction SilentlyContinue
if ($FrontendProcess) {
    Stop-Process -Id $FrontendProcess.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Killed Frontend (Port $FrontendPort)" -ForegroundColor Yellow
}
# Kill Ngrok
Stop-Process -Name "ngrok" -ErrorAction SilentlyContinue
# Remove old logs
Remove-Item backend.log, frontend.log -ErrorAction SilentlyContinue

Write-Host "--- STARTING SESSIONS ---" -ForegroundColor Green

# 3. BACKEND WINDOW
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd backend; python -m venv backend_env; .\backend_env\Scripts\Activate.ps1; pip install -r requirements.txt; python app.py 2>&1 | tee ../backend.log"

# 4. NGROK WINDOW (Tunneling Frontend Port 8081)
# We run this natively so you can see the URL Dashboard
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "ngrok http $FrontendPort"

# 5. FRONTEND WINDOW (With Version Fix & Port Injection)
# - Deletes node_modules to clear the version mismatch
# - Runs 'npm install' to get base packages
# - Runs 'npx expo install --fix' to align React versions
# - Injects SERVER_PORT so the app knows where the backend is
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd DutchLearningApp; Write-Host 'Cleaning node_modules to fix version mismatch...' -ForegroundColor Yellow; Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue; npm install; npx expo install --fix; npx expo install expo-speech expo-font expo-av expo-file-system react-dom; `$env:SERVER_PORT = '$SERVER_PORT'; Write-Host 'Backend Port loaded: ' `$env:SERVER_PORT -ForegroundColor Green; npx expo start --offline 2>&1 | tee ../frontend.log"
