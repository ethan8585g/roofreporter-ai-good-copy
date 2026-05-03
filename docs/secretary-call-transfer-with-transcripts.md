# Call Transfer with Post-Transfer Transcripts — Implementation Guide

## What the customer is asking for

The AI secretary answers the call, qualifies it, and when appropriate transfers the caller to a real employee (sales rep, office manager, etc.). After the transfer the AI steps out of the conversation, but Roof Manager continues recording and transcribing what the caller and the employee say to each other. The owner can open the call in the portal afterwards and read the full transcript — both the AI portion and the human-to-human portion.

This is a common "warm transfer with full recording" pattern used by enterprise call-center products. It is absolutely achievable on the current stack (LiveKit + Twilio SIP + Cloudflare Workers + D1), but it requires meaningful work across the Python agent, the SIP configuration, the Workers API, the D1 schema, and the customer portal.

## The key architectural decision

There are two ways to transfer a SIP call, and only one of them lets us keep the transcript.

**SIP REFER (cold transfer).** The agent sends a REFER message to Twilio telling it to hand the caller off to a new number. Twilio builds a new leg directly between the caller and the employee, and the original LiveKit room ends. This is cheap — after the REFER we are no longer paying for LiveKit minutes or SIP trunking — but once the call leaves our infrastructure we have zero visibility into it. No audio, no transcript, nothing. This is what most "AI phone" products do and is **not** what the customer wants.

**Bridged transfer (warm transfer / conference).** The agent stays in control of the LiveKit room, dials the employee as a second SIP participant into the same room, optionally does a brief handoff announcement to the employee, and then disconnects the AI participant while leaving the room open. The caller and the employee now talk to each other through LiveKit's audio bridge. Because the media is still flowing through our LiveKit room, we can keep an STT pipeline running and keep appending to the transcript. This is the pattern we need.

Everything below assumes the bridged-transfer architecture.

## The second key decision — who runs STT after the AI leaves

Today, STT runs inside the LiveKit Agent session (Deepgram plugin attached to the `AgentSession`). When the agent participant disconnects, that session ends and STT stops. So we cannot just "let the room keep running" — we have to move STT out of the agent session.

Two reasonable options:

**Option 1 — keep a silent agent in the room.** Instead of fully disconnecting the AI, we disconnect the voice/LLM/TTS pieces and leave a stripped-down "ghost" participant subscribed to audio with STT still attached. It publishes no audio and runs no LLM. This is the simplest option because it reuses the existing Deepgram pipeline and session lifecycle. Cost impact is small — STT minutes and a tiny participant slot.

**Option 2 — dedicated transcription worker.** Spin up a separate lightweight worker (Python or Node) that joins the room as a non-publishing participant when the transfer fires, runs its own Deepgram streaming session with diarization enabled, and streams chunks back to the Workers API. This is cleaner long-term (decouples transcription from the agent lifecycle, lets you scale them independently) but is more code.

Start with Option 1, migrate to Option 2 later if transcription reliability becomes an issue or you want to offer transcripts to other products (outbound cold-call agent, etc.).

## End-to-end flow

1. Caller dials the customer's forwarded number. Twilio routes the SIP invite to LiveKit using the existing dispatch rule. A room is created named `secretary-{customerId}-{uuid}`.
2. The agent joins, fetches config from `/api/agents/agent-config/{customerId}`, greets the caller with the configured greeting script.
3. Caller states why they're calling. Agent qualifies them against the configured rules (answering mode / full mode / department routing).
4. Agent decides to transfer. The decision can come from:
   - The LLM invoking a new `transfer_call` function tool (e.g. caller says "I want to talk to the owner")
   - A hard routing rule fired from the config (e.g. "always transfer service calls to the service line")
   - A keyword match ("emergency", "urgent")
5. Agent calls `transfer_call(employee_id, announcement)`. The tool:
   a. Inserts a row into `call_transfers` with status `dialing`.
   b. Uses LiveKit's `SIPParticipantService.create_sip_participant` to dial the configured employee phone number into the same room as a new SIP participant.
   c. Waits for the employee participant to connect (listen for `ParticipantConnected` event with a timeout of ~25s).
   d. If the employee picks up: agent briefly announces the transfer to the employee ("Hi John, I have Jane on the line asking about a roof repair quote, connecting you now"), then disconnects its own LLM/TTS while keeping an STT-only listener in the room. Marks `call_transfers.status = 'connected'`.
   e. If the employee doesn't pick up: agent reclaims the call, tells the caller the transfer failed, falls back to take-message flow. Marks `status = 'failed'`.
6. After handoff, the STT listener diarizes the room audio, tagging each utterance as `caller` or `employee` based on which participant published the audio frame. Transcript chunks are posted to `/api/secretary/webhook/transcript-chunk` every 5 seconds or at end-of-utterance.
7. When the caller or employee hangs up, the LiveKit room ends. A final `room_finished` webhook hits Workers and stitches the pre-transfer + post-transfer transcripts into a single `call_logs.call_transcript`, plus separate `pre_transfer_transcript` and `post_transfer_transcript` fields for the UI.
8. The customer opens the call log in the portal and sees three tabs: "AI portion", "After transfer", and "Full call".

## Required changes

### Database (new migration `migrations/0099_call_transfer_support.sql`)

Add a `secretary_employees` table — the directory of humans the AI can transfer to. Today the code uses a `directories` JSON blob on `secretary_config`; promote it to a first-class table with per-employee fields because the UI will need status (available / away), preferred hours, and the ability to edit each entry independently.

```sql
CREATE TABLE IF NOT EXISTS secretary_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,                     -- 'Owner', 'Sales', 'Service Manager', etc.
  phone_number TEXT NOT NULL,    -- E.164
  transfer_enabled INTEGER DEFAULT 1,
  available_hours TEXT,          -- JSON: { mon: [{from,to}], ... }
  priority INTEGER DEFAULT 100,  -- lower = preferred when multiple match
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_secretary_employees_customer ON secretary_employees(customer_id);

CREATE TABLE IF NOT EXISTS call_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_log_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  employee_id INTEGER,
  employee_name TEXT,            -- denormalized for historical accuracy
  employee_phone TEXT,
  initiated_at TEXT NOT NULL,
  connected_at TEXT,
  ended_at TEXT,
  status TEXT NOT NULL,          -- dialing|connected|failed|no_answer|caller_hung_up
  failure_reason TEXT,
  post_transfer_duration_seconds INTEGER,
  FOREIGN KEY (call_log_id) REFERENCES call_logs(id)
);
CREATE INDEX idx_call_transfers_call_log ON call_transfers(call_log_id);
CREATE INDEX idx_call_transfers_customer ON call_transfers(customer_id);
```

Extend `call_logs` with transcript-segmentation fields (keeping the existing `call_transcript` column for backward compat):

```sql
ALTER TABLE call_logs ADD COLUMN pre_transfer_transcript TEXT;
ALTER TABLE call_logs ADD COLUMN post_transfer_transcript TEXT;
ALTER TABLE call_logs ADD COLUMN transfer_happened INTEGER DEFAULT 0;
ALTER TABLE call_logs ADD COLUMN transferred_to_employee_id INTEGER;
```

Extend `secretary_config` with a feature flag and a default announcement script:

```sql
ALTER TABLE secretary_config ADD COLUMN transfer_enabled INTEGER DEFAULT 0;
ALTER TABLE secretary_config ADD COLUMN transfer_announcement TEXT DEFAULT 'Hi, I have {caller_name} on the line. They said: {reason_summary}. Connecting you now.';
ALTER TABLE secretary_config ADD COLUMN record_post_transfer INTEGER DEFAULT 1;
ALTER TABLE secretary_config ADD COLUMN post_transfer_disclosure TEXT DEFAULT 'Please note this call will continue to be recorded for quality and training purposes.';
```

### Workers API (`src/routes/secretary.ts`)

New endpoints:

- `GET /api/secretary/employees` — list for the authenticated customer
- `POST /api/secretary/employees` — create
- `PATCH /api/secretary/employees/:id` — edit
- `DELETE /api/secretary/employees/:id`
- `PUT /api/secretary/transfer-settings` — toggle `transfer_enabled`, set announcement + disclosure scripts
- `GET /api/secretary/calls/:id/transfer` — return the `call_transfers` row + both transcript halves, used by the portal detail view
- `POST /api/secretary/webhook/transcript-chunk` — called by the STT listener every few seconds during the call. Payload: `{ call_log_id, segment, speaker, text, t_start, t_end, is_post_transfer }`. Appends to `call_logs.pre_transfer_transcript` or `post_transfer_transcript` depending on `is_post_transfer`.
- `POST /api/secretary/webhook/transfer-initiated` — called by the agent when it fires the transfer tool. Inserts `call_transfers` row.
- `POST /api/secretary/webhook/transfer-connected` — employee picked up. Updates row status + `connected_at`.
- `POST /api/secretary/webhook/transfer-failed` — no answer or error. Updates row.

Also extend the existing `/api/agents/agent-config/:customerId` to return:
- `employees` (list of available employees, filtered by `transfer_enabled=1` and current-time availability)
- `transfer_enabled`
- `transfer_announcement`
- `post_transfer_disclosure`

### LiveKit agent (`livekit-agent/src/agent.py`)

Replace the fake `transfer_to_department` tool with a real one. Core logic:

```python
from livekit import api
from livekit.protocol.sip import CreateSIPParticipantRequest

@function_tool
async def transfer_call(
    self,
    context: RunContext,
    employee_name: str,
    reason_summary: str,
    caller_name: str = "a caller",
):
    """Transfer the caller to a specific employee by name.

    The AI disconnects after handing off but the call continues to be
    recorded and transcribed.
    """
    if not self._config.get("transfer_enabled"):
        return "Transfer isn't enabled for this account. I'll take a message instead."

    employees = self._config.get("employees", [])
    target = next(
        (e for e in employees if e["name"].lower() == employee_name.lower()),
        None,
    ) or next(
        (e for e in employees if employee_name.lower() in e["name"].lower()),
        None,
    )
    if not target:
        available = ", ".join(e["name"] for e in employees) or "none configured"
        return f"I don't have an employee named {employee_name}. Available: {available}."

    # Tell the caller
    await self.session.say(
        f"One moment, I'll connect you to {target['name']} now. "
        f"Please note this call will continue to be recorded for quality and training purposes.",
        allow_interruptions=False,
    )

    # Mark transfer as initiated server-side
    await self._notify_workers("/api/secretary/webhook/transfer-initiated", {
        "customer_id": self._config["customer_id"],
        "call_log_id": self._call_log_id,
        "employee_id": target["id"],
        "employee_name": target["name"],
        "employee_phone": target["phone_number"],
        "reason_summary": reason_summary,
    })

    # Dial the employee into the same room
    lk = api.LiveKitAPI()
    try:
        participant = await lk.sip.create_sip_participant(
            CreateSIPParticipantRequest(
                sip_trunk_id=self._config["outbound_trunk_id"],
                sip_call_to=target["phone_number"],
                room_name=context.room.name,
                participant_identity=f"employee-{target['id']}",
                participant_name=target["name"],
                play_dialtone=True,
            )
        )
    except Exception as e:
        await self._notify_workers("/api/secretary/webhook/transfer-failed", {
            "call_log_id": self._call_log_id,
            "failure_reason": f"dial_error: {e}",
        })
        return "I couldn't reach them right now. Let me take a message instead."

    # Wait for them to connect (up to 25s)
    connected = await self._wait_for_participant(f"employee-{target['id']}", timeout=25)
    if not connected:
        await self._notify_workers("/api/secretary/webhook/transfer-failed", {
            "call_log_id": self._call_log_id,
            "failure_reason": "no_answer",
        })
        return "They didn't pick up. Would you like to leave a message?"

    # Private handoff announcement — mute the caller's audio to the employee
    # briefly while the AI whispers the context. LiveKit subscriptions let us
    # route a say() to just the employee participant.
    await self.session.say(
        f"Hi {target['name']}, I have {caller_name} on the line. "
        f"{reason_summary}. Connecting you now.",
        to_participants=[f"employee-{target['id']}"],
        allow_interruptions=False,
    )

    await self._notify_workers("/api/secretary/webhook/transfer-connected", {
        "call_log_id": self._call_log_id,
    })

    # Hand off: stop the LLM+TTS but keep an STT-only participant in the room
    await self._transition_to_silent_transcriber(is_post_transfer=True)
    self._outcome = "transferred"
    return None  # AI goes silent
```

Implement `_transition_to_silent_transcriber` by stopping the voice pipeline (`session.voice_agent.stop()` or equivalent), keeping the STT event handlers attached, flipping an internal `_is_post_transfer = True` flag so subsequent transcript chunks are tagged correctly, and subscribing the participant to audio tracks but unpublishing any outbound track.

Implement `_notify_workers` as a small aiohttp POST helper with retry; the agent already has similar code for call-complete — reuse that pattern.

The existing `on_user_speech_committed` and `on_agent_speech_committed` handlers already append to `self._transcript_lines`. Split the transcript storage into `self._pre_transfer_lines` and `self._post_transfer_lines` keyed on `self._is_post_transfer`, and post each chunk to `/api/secretary/webhook/transcript-chunk` in real time (not just at call end) so the portal can show live transcripts if you ever want that later.

### LiveKit outbound trunk

Call transfer requires an outbound SIP trunk configured for each customer so we can dial employees. You already have `POST /api/secretary/sip/outbound-trunk` that creates one, but check the deploy state — some customers may only have an inbound trunk. Make "outbound trunk configured" a precondition for enabling the transfer feature and surface the setup step in the UI.

Also: employees' phone numbers receiving the transfer will see the caller ID of your Twilio outbound number, not the original caller. That's surprising to end users. Fix by setting `from_user` on the SIP participant to the original caller's number, and verify Twilio is configured to allow spoofed caller ID on the trunk (typically requires a verified caller ID or CNAM setup). Document this in the guide you give customers.

### Portal UI

Add a **Transfer** tab inside the existing Secretary page (`public/static/secretary.js` — the file is already ~2200 lines, so extract the new tab into its own IIFE to keep diffs reviewable).

- Toggle: "Enable call transfers"
- Employee manager: list, add, edit, delete. Each row has name, role, phone, available hours, priority, enabled toggle. Validate phone as E.164.
- Default announcement template (with `{caller_name}` and `{reason_summary}` placeholders).
- Post-transfer recording disclosure textarea (required — see compliance notes below).

In the call logs view, render three tabs per call: **AI portion**, **After transfer**, **Full call**. Hide the "After transfer" tab if `transfer_happened = 0`. Show the transfer destination (employee name + duration of post-transfer segment) as a badge on the call row.

### Compliance — this is load-bearing, don't skip it

Recording a conversation between a caller and an employee, especially without the caller actively knowing we're still listening after the "transfer", is legally fraught. Rules vary by jurisdiction and many of your customers operate in two-party-consent states (California, Florida, Illinois, etc., plus all of Canada under PIPEDA and provincial equivalents).

Minimum safeguards to build in:

1. **Explicit disclosure before transfer.** The AI's transfer script must say something like "Please note this call will continue to be recorded for quality and training purposes." This is in the example above. Don't let customers edit it to an empty string — enforce a minimum length server-side.
2. **Tone or beep at transfer.** Play a short tone to the caller when the transfer completes so there's no moment of silence where they don't know what's happening.
3. **Disclosure in the greeting too.** The initial greeting script should mention "this call may be recorded" if `record_post_transfer = 1`. Add a default template and warn the customer if they remove it.
4. **Retention controls.** Give customers a setting for how long post-transfer transcripts are retained (30/90/365/forever) and a way to delete individual transcripts on request.
5. **Per-employee opt-in.** When a customer adds an employee, require them to tick a box confirming they've informed that employee their calls may be recorded. This protects you — if an employee later complains, the customer has attested they got consent.
6. **Region-specific language.** If the customer's business_phone area code is in a two-party-consent state, surface a warning in the Transfer tab flagging their stricter obligations. Don't block — just inform.

Put a short "recording compliance" paragraph in the onboarding flow and in your Terms so the liability sits with the customer, not Roof Manager.

## Rollout plan

**Phase 1 — plumbing only, no UI** (~2 days)
Schema migration, new Workers endpoints, transcript-chunk webhook, feature flag off by default. Exercise end-to-end with curl + a manually-triggered transfer in dev.

**Phase 2 — agent wiring** (~3 days)
Replace `transfer_to_department` with `transfer_call`. Test against a real Twilio number and a real cell phone. Verify caller ID, tone, disclosure, and that STT keeps running after the AI drops. Validate that hangup from either side triggers the `room_finished` webhook and the call log gets stitched correctly.

**Phase 3 — portal UI** (~3 days)
Employee manager, transfer settings, three-tab transcript view. Add empty states and the compliance warnings.

**Phase 4 — opt-in beta** (1 week)
Enable for the requesting customer plus 2–3 others you pick. Monitor LiveKit minute costs, Deepgram bill, and any transcript stitching bugs. Most likely sources of issues: caller-ID surprises to employees, transfer races (employee picks up just as the AI says "they didn't pick up"), and STT dropouts on poor cell connections.

**Phase 5 — GA** 
Pricing: post-transfer minutes cost real money on both LiveKit and Deepgram. Rough math at current rates: a 10-minute post-transfer call costs roughly $0.10–0.20 (LiveKit SIP minute + Deepgram streaming). Bundle the first N minutes per month into the plan and meter overages, or add $10–15/mo to the plan that unlocks this feature.

## Things you'll want to get right before you ship

- **Caller-ID on the employee leg.** Employees will reject or ignore calls from an unknown number. Test the SIP `from_user` override and make sure Twilio trunk config allows it. If you can't spoof the original caller's number (varies by carrier), at least set it to the customer's own business number so the employee recognizes it.
- **Silent STT reliability.** The biggest risk: the AI disconnects, STT stops silently, and the customer thinks it's recording when it isn't. Add a heartbeat — the STT listener emits a ping every 10s to `/api/secretary/webhook/transcript-heartbeat`. If Workers doesn't see a heartbeat for 60s during an active transfer, flag the call with `transcription_partial = 1` and surface that in the UI.
- **Room cleanup.** Currently the room ends when the agent disconnects. After this change the room must survive agent disconnect. Verify LiveKit room TTL / auto-close behavior — you may need to set `empty_timeout` on the room or keep a participant attached until real hangup.
- **Stop a transferred call cleanly.** If the caller hangs up, the employee participant should be disconnected too. LiveKit won't do that automatically — you need a room event listener that fires "if only the employee is left, end the room".
- **Backward compatibility.** The existing `directories` JSON on `secretary_config` is still used in prompts (`routes/secretary.ts:677`). Keep writing to both `secretary_employees` and `directories` during a migration window so nothing breaks if someone rolls back.

## What to tell the customer today

Yes this is buildable, it's a ~2 week project once it's prioritized, and the transcript capture works because the call stays inside our audio infrastructure during and after the transfer rather than handing off to the phone network. There's a compliance angle (you have to disclose recording to the caller, and you're responsible for telling your employees their calls are recorded) — we'll build the disclosure prompts and opt-in checkboxes so that's handled by default. Expect this to be a paid add-on or part of a higher-tier plan because the post-transfer portion costs us real voice + STT minutes.
