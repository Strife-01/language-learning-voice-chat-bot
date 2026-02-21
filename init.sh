#!/bin/bash

# --- CONFIGURATION ---
PROJECT_DIR=$(pwd)
ENV_FILE="$PROJECT_DIR/backend/.env"
FRONTEND_PORT=8081

# 1. READ BACKEND PORT
if [ -f "$ENV_FILE" ]; then
  SERVER_PORT=$(grep SERVER_PORT "$ENV_FILE" | cut -d '=' -f2)
else
  SERVER_PORT=40811
fi

echo "--- CLEANUP ---"
lsof -ti :$SERVER_PORT | xargs kill -9 2>/dev/null
lsof -ti :$FRONTEND_PORT | xargs kill -9 2>/dev/null
pkill ngrok
rm -f backend.log frontend.log

echo "--- STARTING ---"

# 2. BACKEND WINDOW
osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR/backend' && python3 -m venv backend_env && source backend_env/bin/activate && pip install -r requirements.txt && python3 app.py 2>&1 | tee -a ../backend.log\""

# 3. NGROK WINDOW (Tunneling Frontend Port 8081)
osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR' && ngrok http $FRONTEND_PORT\""

# 4. FRONTEND WINDOW (Fixed Dependency Order)
# CHANGED: Added 'npm install' before 'npx expo install --fix'
osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR/DutchLearningApp' && rm -rf node_modules package-lock.json && npm install && npx expo install --fix && npx expo install expo-speech expo-font expo-av expo-file-system && echo '--------------------------------'; echo 'Frontend Port: $FRONTEND_PORT'; echo 'Backend Port: $SERVER_PORT'; echo '--------------------------------'; export SERVER_PORT=$SERVER_PORT && npx expo start --offline 2>&1 | tee -a ../frontend.log\""
