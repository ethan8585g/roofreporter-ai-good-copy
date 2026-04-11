FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download model files for VAD (preload for faster cold starts)
RUN python -c "from livekit.plugins import silero; silero.VAD.load()"

# Copy all agent code
COPY src/ ./src/

# Health check endpoint (LiveKit agent exposes HTTP on port 8081)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD curl -f http://localhost:8081/ || exit 1

# Run the unified agent server
CMD ["python", "src/main.py", "start"]
