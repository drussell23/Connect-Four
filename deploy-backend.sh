#!/bin/bash

echo "🚀 Backend Deployment Helper"
echo "==========================="
echo ""
echo "📋 Deployment Checklist:"
echo ""
echo "1. ✅ render.yaml is configured correctly with:"
echo "   - runtime: node"
echo "   - rootDir: backend"
echo "   - Correct build/start commands"
echo ""
echo "2. 📝 Environment variables needed in Render Dashboard:"
echo "   NODE_ENV=production"
echo "   PORT=3000"
echo "   CORS_ORIGINS=https://connect-four-ai-derek.vercel.app"
echo "   FRONTEND_URL=https://connect-four-ai-derek.vercel.app"
echo "   ML_SERVICE_URL=https://connect-four-ai-derek.onrender.com"
echo ""
echo "3. 🔗 Your service URLs:"
echo "   Backend: https://connect-four-ai-derek.onrender.com"
echo "   Frontend: https://connect-four-ai-derek.vercel.app"
echo ""
echo "4. 🛠️ To deploy on Render:"
echo "   a) Go to https://dashboard.render.com"
echo "   b) Click on 'connect-four-backend' service"
echo "   c) Click 'Manual Deploy' → 'Deploy latest commit'"
echo "   d) Watch the logs for any errors"
echo ""
echo "5. ✅ To verify deployment:"
echo "   curl https://connect-four-ai-derek.onrender.com/api/health"
echo ""
echo "Press Enter to test local backend build..."
read

echo "🔨 Testing backend build locally..."
cd backend
npm run build
echo "✅ Build test complete!" 