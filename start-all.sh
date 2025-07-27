#!/bin/bash

# =====================================================
# 🚀 CONNECT FOUR - START ALL SERVICES
# =====================================================
# This script starts all services for the Connect Four game
# Usage: ./start-all.sh or npm run start:all

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Connect Four Game Services...${NC}"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Must run from project root directory${NC}"
    exit 1
fi

# Clean up existing services
echo -e "${YELLOW}🔧 Cleaning up existing services...${NC}"
npm run stop:simple 2>/dev/null || true
sleep 2

# Function to start services in background with proper job control
start_service() {
    local name=$1
    local dir=$2
    shift 2
    local cmd="$@"
    
    echo -e "${GREEN}🟢 Starting $name...${NC}"
    (cd "$dir" && eval "$cmd") > "logs/${name}.log" 2>&1 &
    local pid=$!
    echo "   PID: $pid"
    
    # Store PID for stop script
    echo "$pid" > "logs/${name}.pid"
}

# Create logs directory if it doesn't exist
mkdir -p logs

# Clear old PID files
rm -f logs/*.pid

# Start all services with proper environment variables
echo -e "${BLUE}📦 Starting Backend Service...${NC}"
start_service "backend" "backend" "PORT=3000 BACKEND_PORT=3000 npm run start:dev"

echo -e "${BLUE}⚛️  Starting Frontend Service...${NC}"
start_service "frontend" "frontend" "PORT=3001 npm start"

echo -e "${BLUE}🤖 Starting ML Service...${NC}"
start_service "ml_service" "ml_service" "PORT=8000 python3 ml_service.py"

echo -e "${BLUE}🧠 Starting ML Inference Service...${NC}"
start_service "ml_inference" "ml_service" "ML_INFERENCE_PORT=8001 python3 enhanced_inference.py"

echo -e "${BLUE}🔗 Starting AI Coordination Hub...${NC}"
start_service "ai_coordination" "ml_service" "AI_COORDINATION_PORT=8002 python3 ai_coordination_hub.py"

echo -e "${BLUE}🎓 Starting Python Trainer Service (Minimal)...${NC}"
start_service "python_trainer" "backend/src/ai/hybrid-architecture/python-trainer" "PORT=8003 python3 training_service_minimal.py"

# Wait and check services
echo -e "${YELLOW}⏳ Waiting for services to start...${NC}"
sleep 5

# Check if services are running
check_service() {
    local port=$1
    local name=$2
    if lsof -i :$port | grep -q LISTEN; then
        echo -e "${GREEN}✅ $name is running on port $port${NC}"
        return 0
    else
        echo -e "${RED}❌ $name failed to start on port $port${NC}"
        return 1
    fi
}

echo ""
echo -e "${BLUE}🔍 Checking service status...${NC}"
echo -e "${YELLOW}   Backend needs extra time to initialize...${NC}"
sleep 10

# Check each service
BACKEND_OK=false
FRONTEND_OK=false
ML_OK=false

# Backend needs more time due to ML model initialization
BACKEND_RETRIES=10
BACKEND_RETRY_DELAY=5
for i in $(seq 1 $BACKEND_RETRIES); do
    if check_service 3000 "Backend"; then
        BACKEND_OK=true
        break
    elif [ $i -lt $BACKEND_RETRIES ]; then
        echo -e "${YELLOW}   Backend initialization in progress (attempt $i/$BACKEND_RETRIES)...${NC}"
        # Show what the backend is doing
        if [ -f "logs/backend.log" ]; then
            LAST_LOG=$(tail -1 logs/backend.log | head -c 100)
            if [ ! -z "$LAST_LOG" ]; then
                echo -e "${YELLOW}   Status: ${LAST_LOG}...${NC}"
            fi
        fi
        sleep $BACKEND_RETRY_DELAY
    fi
done

check_service 3001 "Frontend" && FRONTEND_OK=true
check_service 8000 "ML Service" && ML_OK=true

# Check additional AI services
ML_INFERENCE_OK=false
AI_COORD_OK=false
PYTHON_TRAINER_OK=false
check_service 8001 "ML Inference" && ML_INFERENCE_OK=true
check_service 8002 "AI Coordination" && AI_COORD_OK=true
check_service 8003 "Python Trainer" && PYTHON_TRAINER_OK=true

echo ""
if [ "$BACKEND_OK" = true ] && [ "$FRONTEND_OK" = true ] && [ "$ML_OK" = true ] && [ "$ML_INFERENCE_OK" = true ] && [ "$AI_COORD_OK" = true ] && [ "$PYTHON_TRAINER_OK" = true ]; then
    echo -e "${GREEN}✅ All services are running successfully!${NC}"
    echo ""
    echo -e "${BLUE}📋 Service URLs:${NC}"
    echo "   - Frontend: http://localhost:3001"
    echo "   - Backend API: http://localhost:3000/api"
    echo "   - Backend Health: http://localhost:3000/api/health"
    echo "   - AI Resources: http://localhost:3000/api/games/ai/resources"
    echo "   - ML Service: http://localhost:8000"
    echo "   - ML Inference: http://localhost:8001"
    echo "   - AI Coordination: http://localhost:8002"
    echo "   - Python Trainer: http://localhost:8003"
    echo ""
    echo -e "${YELLOW}📁 Logs available in:${NC}"
    echo "   - Backend: logs/backend.log"
    echo "   - Frontend: logs/frontend.log"
    echo "   - ML Service: logs/ml_service.log"
    echo "   - ML Inference: logs/ml_inference.log"
    echo "   - AI Coordination: logs/ai_coordination.log"
    echo "   - Python Trainer: logs/python_trainer.log"
    echo ""
    echo -e "${BLUE}🛑 To stop all services, run:${NC} npm run stop:all"
else
    echo -e "${RED}⚠️  Some services failed to start!${NC}"
    echo "Check the logs in the logs/ directory for details"
    exit 1
fi 