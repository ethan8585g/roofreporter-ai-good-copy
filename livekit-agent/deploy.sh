#!/bin/bash
# ============================================================
# RoofReporterAI LiveKit Agent — Quick Deploy Script
# Deploys the AI secretary agent on any Linux server
# ============================================================

set -e

echo "🏠 RoofReporterAI — LiveKit Agent Deployment"
echo "============================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << 'ENVEOF'
LIVEKIT_URL=wss://roofreporterai-btkwkiwh.livekit.cloud
LIVEKIT_API_KEY=APIsvVZsCCaboLY
LIVEKIT_API_SECRET=UwHeCz8KszKbdgSafJjCfsEdzlYmvJZLfchTBROPJryC
ROOFPORTER_API_URL=https://www.roofmanager.ca
DEFAULT_GREETING=Thank you for calling! This is Sarah. How can I help you today?
ENVEOF
    echo "✅ .env created"
fi

# Install Python dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt --quiet

# Start the agent
echo "🚀 Starting LiveKit agent..."
python3 agent.py start
