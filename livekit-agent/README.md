# Roof Manager — LiveKit Voice Agent

## AI Secretary for Rick's Roofing
**Phone:** +1-484-964-9758 (AI) ← forwarded from +1-780-983-3335 (business)

This Python agent answers inbound phone calls routed through LiveKit SIP. It uses:
- **Deepgram Nova 3** for speech-to-text
- **OpenAI GPT-4.1 Mini** (via LiveKit Inference) for conversation
- **Cartesia Sonic 3** for natural text-to-speech
- **Silero VAD** for voice activity detection

---

## Call Flow
```
Homeowner dials 780-983-3335
  → Rogers call-forwarding to +14849649758
    → LiveKit SIP Trunk (ST_acLimvCPo5ES)
      → Dispatch Rule (SDR_cZDM2nFXpW7o) creates room "secretary-2-{caller}-{uuid}"
        → This agent auto-joins the room
          → Sarah answers: "Thank you for calling Rick's Roofing..."
```

---

## Permanent Deployment — LiveKit Cloud (Option A, Recommended)

### Prerequisites
- Git installed on your local machine (Mac, Windows, or Linux)
- A LiveKit Cloud account (the same one at https://cloud.livekit.io that owns the `roofreporterai-btkwkiwh` project)

### Step-by-Step Instructions

#### 1. Install the LiveKit CLI

**Mac:**
```bash
brew install livekit-cli
```

**Linux:**
```bash
curl -sSL https://get.livekit.io/cli | bash
```

**Windows (PowerShell):**
```powershell
winget install LiveKit.LiveKitCLI
```

Verify installation:
```bash
lk --version
# Should show: lk version 2.x.x
```

#### 2. Clone the Repository
```bash
git clone https://github.com/ethan8585g/roofreporter-ai-good-copy.git
cd roofreporter-ai-good-copy/livekit-agent
```

#### 3. Authenticate with LiveKit Cloud
```bash
lk cloud auth
```
This opens your browser — log in with the same LiveKit account that owns the `roofreporterai-btkwkiwh` project. After login, the CLI stores credentials locally.

#### 4. Set the Default Project
```bash
lk project list
# You should see: roofreporterai-btkwkiwh

lk project set-default "roofreporterai-btkwkiwh"
```

#### 5. Deploy the Agent
```bash
lk agent create --yes .
```

This command:
- Reads `livekit.toml` for configuration
- Builds the Docker image using `Dockerfile`
- Uploads the image to LiveKit Cloud
- Registers the agent as `roofer-secretary`
- LiveKit Cloud auto-injects `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

#### 6. Verify Deployment
```bash
# Check agent status
lk agent status

# View live logs
lk agent logs

# Tail logs in real-time
lk agent tail
```

#### 7. Test It — Call 780-983-3335
Dial the business number and Sarah should answer within 2-3 rings.

---

### Updating the Agent (Future Deployments)
After making changes to `agent.py`:
```bash
cd roofreporter-ai-good-copy/livekit-agent
git pull origin main
lk agent deploy --yes .
```
LiveKit Cloud performs zero-downtime rolling updates.

### Managing Secrets
If you need to add/change environment variables:
```bash
lk agent update-secrets ROOFPORTER_API_URL=https://www.roofmanager.ca
```

### Monitoring
```bash
lk agent status        # Health and resource usage
lk agent logs          # Recent logs
lk agent tail          # Live log stream
lk agent versions      # Deployment history
lk agent rollback      # Roll back to previous version
```

---

## Alternative: VPS Deployment (Option B, ~$5/mo)

### Quick Start with Docker
```bash
git clone https://github.com/ethan8585g/roofreporter-ai-good-copy.git
cd roofreporter-ai-good-copy/livekit-agent

# Create .env file with your credentials
cat > .env << 'EOF'
LIVEKIT_URL=wss://roofreporterai-btkwkiwh.livekit.cloud
LIVEKIT_API_KEY=APIsvVZsCCaboLY
LIVEKIT_API_SECRET=<your-api-secret>
ROOFPORTER_API_URL=https://www.roofmanager.ca
EOF

# Start with Docker Compose
docker-compose up -d

# Check logs
docker-compose logs -f
```

### Quick Start without Docker
```bash
cd roofreporter-ai-good-copy/livekit-agent
pip install -r requirements.txt
# Set environment variables (or create .env file)
python agent.py start
```

### Recommended VPS Providers
| Provider | Plan | Price | Notes |
|----------|------|-------|-------|
| Railway | Starter | Free tier | Docker deploy, auto-restart |
| Render | Starter | $7/mo | Docker deploy, auto-restart |
| DigitalOcean | Basic Droplet | $6/mo | Full control, SSH access |
| Hetzner | CX22 | €4.15/mo | Best value, EU/US regions |

---

## Architecture

### Files
| File | Purpose |
|------|---------|
| `agent.py` | Main agent code — handles calls, Q&A, message taking |
| `livekit.toml` | LiveKit Cloud deployment config |
| `Dockerfile` | Docker build for containerized deployment |
| `requirements.txt` | Python dependencies |
| `docker-compose.yml` | VPS deployment config |
| `deploy.sh` | Quick-start script for VPS |
| `ecosystem.config.cjs` | PM2 config for sandbox/dev mode |

### LiveKit Infrastructure
| Component | ID | Purpose |
|-----------|----|---------|
| SIP Trunk | `ST_acLimvCPo5ES` | Receives calls on +14849649758 |
| Dispatch Rule | `SDR_cZDM2nFXpW7o` | Routes to rooms `secretary-2-*` |
| Agent Worker | `roofer-secretary` | Joins rooms, answers calls |

### Agent Capabilities
- **Greet callers** with Rick's Roofing script
- **Answer Q&A** about pricing, repairs, emergencies, financing, licensing
- **Collect lead data** — name, phone, full address, service type
- **Schedule estimates** — logs to Roof Manager API
- **Handle emergencies** — flags urgent calls, dispatches crew
- **Take messages** — records caller info for callback
- **Report business hours** — Mon-Fri 8 AM to 5 PM + emergency dispatch

### API Endpoints Used
- `GET /api/secretary/agent-config/{customerId}` — fetch greeting, Q&A, directories
- `POST /api/secretary/webhook/message` — log messages taken
- `POST /api/secretary/webhook/appointment` — log estimate requests
- `POST /api/secretary/webhook/call-complete` — log call completion

---

## LiveKit Cloud Free Tier
- **1,000 agent minutes/month** (~16.7 hours of calls)
- Auto-scaling, zero-downtime deployments
- Built-in monitoring and logging
- No server management required

For a roofing business receiving ~20 calls/day averaging 3 minutes each = ~1,800 minutes/month.
You'd need the Growth plan ($0.05/agent-minute) for higher volume.

---

## Troubleshooting

### Agent not answering calls
1. Check `lk agent status` — is the agent running?
2. Check `lk agent logs` — any errors?
3. Verify dispatch rule: `lk sip dispatch list`
4. Verify SIP trunk: `lk sip inbound list`

### Call connects but no audio
- Check STT/TTS models in `agent.py` — ensure they're valid LiveKit Inference models
- Check `ROOFPORTER_API_URL` is accessible

### Agent crashes on startup
- Check `requirements.txt` — all dependencies listed?
- Check `Dockerfile` — system dependencies (gcc) installed?
- Check `lk agent logs` for Python tracebacks

---

---

## Deploying from Super Admin

The Roof Manager super admin dashboard includes a one-click agent deployment feature at `/admin/super/secretary` → **Agent Deploy** tab.

### How it works

1. Super admin clicks **Deploy Agent to LiveKit Cloud** in the dashboard.
2. The app POSTs to `POST /api/admin/superadmin/agent/deploy`, which fires a webhook to trigger deployment.
3. The webhook triggers the GitHub Actions workflow (`.github/workflows/livekit-agent-deploy.yml`), which:
   - Installs the `lk` CLI
   - Reads the subdomain from `livekit-agent/livekit.toml`
   - Runs `lk agent deploy --subdomain roofreporterai-btkwkiwh --yes .`
4. The dashboard polls `GET /api/admin/superadmin/agent/status` every 5 seconds to show progress.

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `LK_CLOUD_TOKEN` | LiveKit Cloud API token (from cloud.livekit.io → Settings → API Keys) |

### Required Cloudflare Env Vars

| Variable | Description |
|----------|-------------|
| `LIVEKIT_DEPLOY_WEBHOOK_URL` | GitHub repository_dispatch URL: `https://api.github.com/repos/{owner}/{repo}/dispatches` |
| `LIVEKIT_DEPLOY_WEBHOOK_SECRET` | (Optional) HMAC secret for webhook signature verification |

### Automatic Deployment

The agent also auto-deploys on push to `main` when any file in `livekit-agent/` changes (via the same GitHub Actions workflow).

---

*Last updated: 2026-04-18 | Version: 9.4 | LiveKit Agents SDK: 1.4.6*
