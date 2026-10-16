#!/usr/bin/env bash
set -e

echo "=========================================="
echo "🚀 Starting Automated Deployment"
echo "📅 $(date)"
echo "=========================================="

# 1. Navigate to Project Directory
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
echo "📂 Working directory: $APP_DIR"

# 2. Fetch and Pull Latest Code from GitHub
echo "📥 Pulling latest changes from Git..."
git fetch origin main
git reset --hard origin/main

# 3. Backend: Python Virtual Environment & Migrations
echo "🐍 Updating Backend..."
if [ -d "backend/.venv" ]; then
    VENV_PATH="backend/.venv"
elif [ -d "$HOME/.venv" ]; then
    VENV_PATH="$HOME/.venv"
elif [ -d "backend/env" ]; then
    VENV_PATH="backend/env"
else
    echo "Creating virtual environment in backend/.venv..."
    python3 -m venv backend/.venv
    VENV_PATH="backend/.venv"
fi

source "$VENV_PATH/bin/activate"
pip install --upgrade pip --quiet
pip install -r backend/requirements.txt --quiet

echo "🗄️ Running Database Migrations..."
python backend/manage.py migrate --noinput

echo "📦 Collecting Static Files..."
python backend/manage.py collectstatic --noinput

# 4. Frontend: Dependencies & Production Build
echo "⚛️ Building Frontend..."
cd frontend
if [ -f "package-lock.json" ]; then
    npm ci --prefer-offline --no-audit
else
    npm install --no-audit
fi
npm run build
cd "$APP_DIR"

# 5. Restart Backend Gunicorn Service
echo "🔄 Restarting Backend Service..."
if sudo systemctl is-active --quiet gunicorn; then
    sudo systemctl restart gunicorn
    echo "✅ gunicorn service restarted"
elif sudo systemctl is-active --quiet camera-gps; then
    sudo systemctl restart camera-gps
    echo "✅ camera-gps service restarted"
else
    echo "⚠️ Restarting gunicorn..."
    sudo systemctl restart gunicorn || true
fi

# 6. Test and Reload Nginx
echo "🌐 Reloading Nginx Web Server..."
sudo nginx -t
sudo systemctl reload nginx || sudo systemctl restart nginx
echo "✅ Nginx reloaded successfully"

echo "=========================================="
echo "🎉 Deployment Completed Successfully!"
echo "=========================================="

