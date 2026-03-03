# RoofReporterAI — Roofer Secretary AI Voice Agent
## Powered by LiveKit Agents + LiveKit Inference

### Quick Deploy Instructions

**This agent answers inbound phone calls for your roofing business using AI.**

Your LiveKit phone number: **+1 (484) 964-9758**
Dispatch Rule ID: `SDR_5F7cAY4SRKfW`

---

### Prerequisites
- Python 3.10+
- [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/start/) installed
- LiveKit Cloud account (already configured)

### Step 1: Install LiveKit CLI (if not already installed)
```bash
brew install livekit-cli   # macOS
# or download from https://github.com/livekit/livekit-cli/releases
```

### Step 2: Authenticate with LiveKit Cloud
```bash
lk cloud auth
```
This opens a browser window. Log in with your LiveKit Cloud account.

### Step 3: Deploy the agent
```bash
cd livekit-agent
lk agent deploy --silent --secrets-file .env.local --ignore-empty-secrets .
```

### Step 4: Verify it's running
```bash
lk agent list
lk agent status
```

### Step 5: Test it!
Call **+1 (484) 964-9758** from any phone. The AI should answer.

---

### How It Works

1. **Inbound call** hits your LiveKit phone number (+14849649758)
2. **Dispatch rule** (SDR_5F7cAY4SRKfW) creates a new room `secretary-call-{uuid}`
3. **This agent** joins the room automatically and greets the caller
4. **AI handles** Q&A, routes to departments, takes messages
5. **Call log** is saved to the RoofReporterAI database

### Agent Configuration

The agent reads customer config from room metadata:
- `greeting_script` — How the AI answers the phone
- `common_qa` — Q&A pairs for automatic responses
- `directories` — Departments the AI can route callers to
- `general_notes` — Additional business context

### Voice Pipeline
| Component | Model | Provider |
|-----------|-------|----------|
| STT | Nova-3 General | Deepgram (via LiveKit Inference) |
| LLM | GPT-4.1 Mini | OpenAI (via LiveKit Inference) |
| TTS | Sonic-3 | Cartesia (via LiveKit Inference) |
| VAD | Silero | Local (preloaded) |

### Cost per call
~$0.10-0.20/minute (STT + LLM + TTS combined via LiveKit Inference)

### File Structure
```
livekit-agent/
├── agent.py           # Main voice agent code
├── .env.local         # LiveKit credentials (secret)
├── requirements.txt   # Python dependencies
├── Dockerfile         # Container for deployment
├── .dockerignore      # Docker build exclusions
├── livekit.toml       # LiveKit project config
└── README.md          # This file
```
