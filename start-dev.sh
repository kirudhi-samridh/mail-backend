#!/bin/bash

echo "🚀 Starting LMAA Backend Services in Development Mode"
echo "=================================================="

# Function to start a service in the background
start_service() {
    local service_name=$1
    local service_dir=$2
    local start_command=$3
    
    echo "📦 Starting $service_name..."
    cd "$service_dir"
    
    if [ "$service_name" = "AI Services" ]; then
        # Python service
        python app.py &
    else
        # Node.js service
        npm run dev &
    fi
    
    local pid=$!
    echo "✅ $service_name started with PID: $pid"
    cd ..
}

# Check if Python is installed
if ! command -v python &> /dev/null; then
    echo "❌ Python is not installed. Please install Python 3.11+ to run AI Services."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ to run the services."
    exit 1
fi

echo "🔧 Installing dependencies..."

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install Python dependencies for AI services
echo "🐍 Installing Python dependencies for AI Services..."
cd ai-services
pip install -r requirements.txt
cd ..

echo ""
echo "🚀 Starting all services..."
echo ""

# Start all services
start_service "API Gateway" "api-gateway" "npm run dev"
start_service "User Management Service" "user-management-service" "npm run dev"
start_service "Email Sync Proxy Service" "email-sync-proxy-service" "npm run dev"
start_service "AI Services" "ai-services" "python app.py"

echo ""
echo "🎉 All services are starting up!"
echo ""
echo "Service URLs:"
echo "- API Gateway: http://localhost:3001"
echo "- User Management: http://localhost:3002"
echo "- Email Service: http://localhost:3003"
echo "- AI Services: http://localhost:3004"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for all background processes
wait 