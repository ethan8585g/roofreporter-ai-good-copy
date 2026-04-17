"""
Roof Manager — Roofer Secretary AI Voice Agent
Powered by LiveKit Agents v1.4 + LiveKit Inference

This agent answers inbound phone calls for roofing businesses.
It pulls the customer's configured greeting, Q&A, and directory routing
from the Roof Manager API, then delivers a professional AI receptionist
experience over the phone.

Supports live call transfer: the AI qualifies the call, dials an employee
into the same LiveKit room, hands off, and stays as a silent "ghost"
participant to keep STT running for post-transfer transcripts.

Flow:
  1. Inbound call hits LiveKit phone number (via SIP trunk)
  2. Dispatch rule routes call to a new room: secretary-{customerId}-{uuid}
  3. This agent auto-joins the room, fetches customer config from the API
  4. Agent greets caller, handles Q&A, routes to departments, takes messages
  5. If transfer: dials employee into room, announces, goes silent (ghost mode)
  6. After call ends, logs the call details back to the Roof Manager API
"""

import os
import re
import json
import time
import logging
import asyncio
from typing import Optional

import aiohttp
from dotenv import load_dotenv
from livekit import rtc, api
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    inference,
    function_tool,
    RunContext,
    room_io,
)
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

load_dotenv(".env.local")

logger = logging.getLogger("roofer-secretary")
logger.setLevel(logging.INFO)

# ============================================================
# API client — communicates with the Roof Manager Cloudflare app
# ============================================================
API_BASE = os.environ.get("ROOFPORTER_API_URL", "https://roofmanager.ca")


async def _api_post(path: str, payload: dict):
    """POST JSON to a Workers endpoint with retry."""
    url = f"{API_BASE}{path}"
    for attempt in range(2):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    body = await resp.text()
                    logger.warning(f"API POST {path} failed (attempt {attempt+1}): HTTP {resp.status} — {body}")
        except Exception as e:
            logger.error(f"API POST {path} error (attempt {attempt+1}): {e}")
        if attempt == 0:
            await asyncio.sleep(1)
    return None


async def fetch_customer_config(customer_id: int) -> Optional[dict]:
    """Fetch secretary configuration for a customer from the API.

    Returns dict with: greeting_script, common_qa, general_notes, directories,
    employees, transfer_enabled, etc.
    Returns None on failure (agent will use fallback defaults).
    """
    url = f"{API_BASE}/api/agents/agent-config/{customer_id}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    logger.info(f"Fetched config for customer {customer_id}: {list(data.keys())}")
                    return data
                else:
                    logger.warning(f"Failed to fetch config for customer {customer_id}: HTTP {resp.status}")
                    return None
    except Exception as e:
        logger.error(f"Error fetching customer config: {e}")
        return None


async def log_call_complete(
    customer_id: int,
    caller_phone: str,
    caller_name: str,
    duration_seconds: int,
    directory_routed: str,
    summary: str,
    transcript: str,
    outcome: str,
    room_id: str,
):
    """POST call details back to Roof Manager for logging. Returns the call_log_id."""
    result = await _api_post("/api/secretary/webhook/call-complete", {
        "customer_id": customer_id,
        "caller_phone": caller_phone,
        "caller_name": caller_name,
        "duration_seconds": duration_seconds,
        "directory_routed": directory_routed,
        "summary": summary,
        "transcript": transcript,
        "outcome": outcome,
        "room_id": room_id,
    })
    if result:
        logger.info(f"Call log saved for customer {customer_id}")
        return result.get("call_log_id")
    return None


# ============================================================
# Config extraction — from room name, metadata, and API
# ============================================================
def extract_customer_id_from_room(room_name: str) -> Optional[int]:
    """Extract customer_id from room name pattern: secretary-{customerId}-{uuid}"""
    match = re.match(r"secretary-(\d+)-", room_name)
    if match:
        return int(match.group(1))
    match = re.match(r"secretary-(\d+)$", room_name)
    if match:
        return int(match.group(1))
    return None


async def get_agent_config(ctx: JobContext) -> dict:
    """Build the full agent config from room metadata + API fetch."""
    config = {
        "customer_id": None,
        "business_phone": "",
        "greeting_script": "Thank you for calling! How can I help you today?",
        "common_qa": "",
        "general_notes": "",
        "directories": [],
        "agent_name": "Sarah",
        "transfer_enabled": False,
        "transfer_announcement": "",
        "post_transfer_disclosure": "",
        "record_post_transfer": True,
        "employees": [],
    }

    # 1. Try room metadata first (set by dispatch rule or /livekit-token)
    room_metadata = ctx.room.metadata
    if room_metadata:
        try:
            meta = json.loads(room_metadata)
            config.update({k: v for k, v in meta.items() if k in config})
            logger.info(f"Config from room metadata: customer_id={config.get('customer_id')}")
        except json.JSONDecodeError:
            logger.warning("Could not parse room metadata as JSON")

    # 2. Extract customer_id from room name if not in metadata
    if not config["customer_id"]:
        cid = extract_customer_id_from_room(ctx.room.name)
        if cid:
            config["customer_id"] = cid
            logger.info(f"Extracted customer_id={cid} from room name: {ctx.room.name}")

    # 3. Fetch full config from the Roof Manager API
    if config["customer_id"]:
        api_config = await fetch_customer_config(config["customer_id"])
        if api_config:
            for key in [
                "greeting_script", "common_qa", "general_notes", "directories",
                "business_phone", "agent_name", "transfer_enabled",
                "transfer_announcement", "post_transfer_disclosure",
                "record_post_transfer", "employees",
            ]:
                if api_config.get(key):
                    config[key] = api_config[key]

    # 4. Detect SIP caller info
    for participant in ctx.room.remote_participants.values():
        attrs = participant.attributes or {}
        if attrs.get("sip.trunkPhoneNumber"):
            logger.info(f"SIP caller: trunk={attrs.get('sip.trunkPhoneNumber')}, "
                        f"from={attrs.get('sip.phoneNumber')}")

    # 5. Env fallbacks
    if config["greeting_script"] == "Thank you for calling! How can I help you today?":
        env_greeting = os.environ.get("DEFAULT_GREETING", "")
        if env_greeting:
            config["greeting_script"] = env_greeting

    return config


# ============================================================
# System prompt builder
# ============================================================
def build_system_prompt(config: dict) -> str:
    """Build the agent's system prompt from customer configuration."""
    agent_name = config.get("agent_name", "Sarah")
    greeting = config.get("greeting_script", "Thank you for calling! How can I help you today?")
    qa = config.get("common_qa", "")
    notes = config.get("general_notes", "")
    directories = config.get("directories", [])
    transfer_enabled = config.get("transfer_enabled", False)
    employees = config.get("employees", [])

    dir_text = ""
    if directories:
        dir_lines = []
        for d in directories:
            name = d.get("name", "Unknown")
            action = d.get("phone_or_action", "take a message")
            notes_d = d.get("special_notes", "")
            line = f"  - {name}: Action = {action}"
            if notes_d:
                line += f" (Notes: {notes_d})"
            dir_lines.append(line)
        dir_text = "\n".join(dir_lines)

    emp_text = ""
    if transfer_enabled and employees:
        emp_lines = []
        for e in employees:
            line = f"  - {e.get('name', 'Unknown')}"
            if e.get("role"):
                line += f" ({e['role']})"
            emp_lines.append(line)
        emp_text = "\n".join(emp_lines)

    transfer_instructions = ""
    if transfer_enabled and employees:
        transfer_instructions = f"""
CALL TRANSFER:
You can transfer the caller to a real employee using the transfer_call tool.
Use this when:
- The caller specifically asks to speak to someone by name
- The caller needs help beyond what you can provide from the Q&A
- The situation is urgent and needs immediate human attention
- The caller asks to speak to a manager, owner, or specific department

Available employees you can transfer to:
{emp_text}

When transferring:
- Tell the caller you'll connect them and ask them to hold briefly
- Use the transfer_call tool with the employee's name and a brief summary of why
- If the transfer fails (employee doesn't pick up), offer to take a message instead
"""

    prompt = f"""You are {agent_name}, a professional AI phone receptionist for a roofing company.
You are answering an inbound phone call. Be warm, friendly, professional, and helpful.
Speak naturally like a real receptionist — use conversational language, not robotic responses.
Keep responses concise since this is a phone call. Avoid long monologues.

IMPORTANT RULES:
- You are on a PHONE CALL. Keep responses VERY BRIEF — 1-2 sentences max per turn.
- RESPOND FAST. Do not over-explain. Be concise and conversational.
- Always listen carefully to what the caller says before responding.
- If you don't understand, politely ask them to repeat.
- If you can answer from the Q&A below, do so confidently and briefly.
- {"If the caller wants to reach a specific person, use the transfer_call tool." if transfer_enabled else "If the caller wants to reach a specific department, use the transfer_to_department tool."}
- If you can't help, offer to take a message using the take_message tool.
- Never reveal that you are an AI unless directly asked. If asked, say "I'm an AI assistant helping answer calls."
- Be empathetic and professional at all times.
- When the conversation is ending, always use the end_call tool to wrap up properly.
- AVOID long monologues. Keep it punchy — a real receptionist doesn't lecture.

YOUR GREETING (say this when you first answer):
{greeting}

COMMON Q&A (use these to answer frequent questions):
{qa if qa else "No specific Q&A configured. Answer general roofing questions to the best of your ability."}

GENERAL BUSINESS NOTES:
{notes if notes else "No additional notes."}

AVAILABLE DEPARTMENTS/DIRECTORIES:
{dir_text if dir_text else "No specific departments configured. Take a message if the caller needs to reach someone specific."}
{transfer_instructions}"""
    return prompt


# ============================================================
# The Voice Agent
# ============================================================
class RooferSecretaryAgent(Agent):
    """AI receptionist that answers calls for roofing businesses."""

    def __init__(self, config: dict, call_start_time: float, ctx: JobContext) -> None:
        self._config = config
        self._call_start_time = call_start_time
        self._ctx = ctx
        self._caller_name = ""
        self._caller_phone = ""
        self._call_summary_parts: list[str] = []
        self._directory_routed = ""
        self._messages_taken: list[dict] = []
        self._outcome = "answered"
        self._pre_transfer_lines: list[str] = []
        self._post_transfer_lines: list[str] = []
        self._is_post_transfer = False
        self._is_ghost_mode = False
        self._call_log_id: Optional[int] = None
        self._transfer_employee_identity: Optional[str] = None
        self._heartbeat_task: Optional[asyncio.Task] = None

        super().__init__(
            instructions=build_system_prompt(config)
        )

    @property
    def _transcript_lines(self) -> list[str]:
        """Combined transcript for backward compat."""
        return self._pre_transfer_lines + self._post_transfer_lines

    def on_user_message(self, message):
        """Capture every caller utterance for transcript."""
        if message and message.text:
            line = f"Caller: {message.text}"
            if self._is_post_transfer:
                self._post_transfer_lines.append(line)
            else:
                self._pre_transfer_lines.append(line)
            # Stream chunk to Workers in real-time
            if self._call_log_id:
                asyncio.create_task(self._send_transcript_chunk(
                    speaker="Caller", text=message.text
                ))
        return super().on_user_message(message)

    def on_agent_message(self, message):
        """Capture every agent/employee response for transcript."""
        if self._is_ghost_mode:
            # In ghost mode, audio comes from the employee, not the AI
            return
        if message and message.text:
            agent_name = self._config.get("agent_name", "Sarah")
            line = f"{agent_name}: {message.text}"
            if self._is_post_transfer:
                self._post_transfer_lines.append(line)
            else:
                self._pre_transfer_lines.append(line)
            if self._call_log_id:
                asyncio.create_task(self._send_transcript_chunk(
                    speaker=agent_name, text=message.text
                ))
        return super().on_agent_message(message)

    async def _send_transcript_chunk(self, speaker: str, text: str):
        """Send a transcript chunk to the Workers API in real-time."""
        if not self._call_log_id:
            return
        await _api_post("/api/secretary/webhook/transcript-chunk", {
            "call_log_id": self._call_log_id,
            "speaker": speaker,
            "text": text,
            "is_post_transfer": self._is_post_transfer,
        })

    async def _start_heartbeat(self):
        """Emit a heartbeat every 10s during post-transfer ghost mode."""
        async def _loop():
            while self._is_ghost_mode and self._call_log_id:
                await _api_post("/api/secretary/webhook/transcript-heartbeat", {
                    "call_log_id": self._call_log_id,
                })
                await asyncio.sleep(10)
        self._heartbeat_task = asyncio.create_task(_loop())

    def _stop_heartbeat(self):
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None

    async def on_enter(self):
        """Called when the agent enters the session — greet the caller."""
        greeting = self._config.get("greeting_script", "Thank you for calling! How can I help you today?")
        self.session.generate_reply(
            instructions=f"Greet the caller with this greeting (adapt slightly to sound natural): {greeting}"
        )

    # ----------------------------------------------------------
    # Transfer tool — bridges the caller to a real employee
    # ----------------------------------------------------------
    @function_tool
    async def transfer_call(
        self,
        context: RunContext,
        employee_name: str,
        reason_summary: str,
        caller_name: str = "a caller",
    ):
        """Transfer the caller to a specific employee by dialing them into this call.
        The AI goes silent after handoff but the call continues to be recorded.

        Args:
            employee_name: The name of the employee to transfer to
            reason_summary: Brief reason for the transfer (what the caller needs)
            caller_name: The caller's name if known
        """
        if not self._config.get("transfer_enabled"):
            return "Transfer isn't enabled for this account. I'll take a message instead."

        employees = self._config.get("employees", [])
        # Exact match first, then partial
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

        self._caller_name = caller_name if caller_name != "a caller" else self._caller_name
        self._directory_routed = target.get("name", employee_name)
        self._call_summary_parts.append(f"Transfer to {target['name']} ({target.get('role', '')}): {reason_summary}")

        # Notify Workers that transfer is starting
        if self._call_log_id:
            await _api_post("/api/secretary/webhook/transfer-initiated", {
                "customer_id": self._config["customer_id"],
                "call_log_id": self._call_log_id,
                "employee_id": target.get("id"),
                "employee_name": target["name"],
                "employee_phone": target["phone_number"],
                "reason_summary": reason_summary,
            })

        # Disclosure to caller
        disclosure = self._config.get("post_transfer_disclosure", "")
        if disclosure:
            self.session.generate_reply(
                instructions=f"Say this to the caller (naturally): One moment, I'll connect you to {target['name']} now. {disclosure}"
            )
            await asyncio.sleep(3)  # Give TTS time to speak

        # Dial the employee into the same room via LiveKit SIP
        employee_identity = f"employee-{target.get('id', 0)}"
        self._transfer_employee_identity = employee_identity

        lk_url = os.environ.get("LIVEKIT_URL", "")
        lk_api_key = os.environ.get("LIVEKIT_API_KEY", "")
        lk_api_secret = os.environ.get("LIVEKIT_API_SECRET", "")
        outbound_trunk_id = os.environ.get("LIVEKIT_OUTBOUND_TRUNK_ID", "")

        if not all([lk_url, lk_api_key, lk_api_secret, outbound_trunk_id]):
            logger.error("Missing LiveKit SIP credentials for transfer")
            if self._call_log_id:
                await _api_post("/api/secretary/webhook/transfer-failed", {
                    "call_log_id": self._call_log_id,
                    "failure_reason": "missing_sip_credentials",
                })
            return "I'm having trouble connecting you right now. Let me take a message instead."

        try:
            lk = api.LiveKitAPI(
                url=lk_url, api_key=lk_api_key, api_secret=lk_api_secret
            )
            # Get the original caller's phone to set as caller-ID
            caller_phone = self._caller_phone or "Unknown"
            sip_call_to = target["phone_number"]

            logger.info(f"Dialing employee {target['name']} at {sip_call_to} into room {self._ctx.room.name}")

            await lk.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    sip_trunk_id=outbound_trunk_id,
                    sip_call_to=sip_call_to,
                    room_name=self._ctx.room.name,
                    participant_identity=employee_identity,
                    participant_name=target["name"],
                )
            )
            await lk.aclose()
        except Exception as e:
            logger.error(f"SIP dial failed: {e}")
            if self._call_log_id:
                await _api_post("/api/secretary/webhook/transfer-failed", {
                    "call_log_id": self._call_log_id,
                    "failure_reason": f"dial_error: {e}",
                })
            return f"I couldn't reach {target['name']} right now. Would you like to leave a message?"

        # Wait for employee to connect (up to 25s)
        connected = await self._wait_for_participant(employee_identity, timeout=25)
        if not connected:
            logger.warning(f"Employee {target['name']} did not pick up within 25s")
            if self._call_log_id:
                await _api_post("/api/secretary/webhook/transfer-failed", {
                    "call_log_id": self._call_log_id,
                    "failure_reason": "no_answer",
                })
            self._outcome = "transfer_failed"
            return f"{target['name']} didn't pick up. Would you like to leave a message for them?"

        # Employee connected — announce the handoff
        announcement = self._config.get("transfer_announcement", "")
        if announcement:
            announcement = announcement.replace("{caller_name}", self._caller_name or "a caller")
            announcement = announcement.replace("{reason_summary}", reason_summary)

        logger.info(f"Employee {target['name']} connected — transitioning to ghost mode")
        if self._call_log_id:
            await _api_post("/api/secretary/webhook/transfer-connected", {
                "call_log_id": self._call_log_id,
                "customer_id": self._config["customer_id"],
            })

        # Say the handoff announcement, then go silent
        if announcement:
            self.session.generate_reply(
                instructions=f"Say this brief handoff (then go completely silent): {announcement}"
            )
            await asyncio.sleep(4)  # Give TTS time to speak the announcement

        # Transition to ghost mode — stop LLM/TTS, keep STT running
        await self._enter_ghost_mode()
        self._outcome = "transferred"
        return None  # AI goes silent

    async def _wait_for_participant(self, identity: str, timeout: float = 25) -> bool:
        """Wait for a participant with the given identity to join the room."""
        deadline = time.time() + timeout
        # Check if already connected
        for p in self._ctx.room.remote_participants.values():
            if p.identity == identity:
                return True

        # Wait for connection event
        connected_event = asyncio.Event()

        def _on_participant_connected(participant):
            if participant.identity == identity:
                connected_event.set()

        self._ctx.room.on("participant_connected", _on_participant_connected)
        try:
            remaining = deadline - time.time()
            if remaining > 0:
                try:
                    await asyncio.wait_for(connected_event.wait(), timeout=remaining)
                    return True
                except asyncio.TimeoutError:
                    return False
            return False
        finally:
            # Clean up listener
            try:
                self._ctx.room.off("participant_connected", _on_participant_connected)
            except:
                pass

    async def _enter_ghost_mode(self):
        """Transition from active AI to silent STT-only ghost.
        Stops the LLM and TTS but keeps STT attached to capture post-transfer audio.
        The agent participant stays in the room but publishes no audio."""
        self._is_ghost_mode = True
        self._is_post_transfer = True

        # Mute our audio output — stop publishing to the room
        try:
            for pub in self._ctx.room.local_participant.track_publications.values():
                if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                    await self._ctx.room.local_participant.set_track_subscription_permissions(
                        publish_tracks=False
                    )
                    break
        except Exception as e:
            logger.warning(f"Could not mute agent audio: {e}")

        # Start heartbeat for monitoring
        await self._start_heartbeat()
        logger.info("Ghost mode active — STT still running, LLM/TTS silenced")

    # ----------------------------------------------------------
    # Existing tools (kept for non-transfer mode and fallback)
    # ----------------------------------------------------------
    @function_tool
    async def transfer_to_department(
        self, context: RunContext, department_name: str, reason: str
    ):
        """Transfer the caller to a specific department or person.
        Used when call transfer is not enabled — gives the caller a phone number.

        Args:
            department_name: The name of the department to transfer to
            reason: Brief reason for the transfer
        """
        # If transfer is enabled and this matches an employee, redirect to transfer_call
        if self._config.get("transfer_enabled"):
            employees = self._config.get("employees", [])
            match = next(
                (e for e in employees if department_name.lower() in e.get("name", "").lower()
                 or department_name.lower() in (e.get("role") or "").lower()),
                None,
            )
            if match:
                return await self.transfer_call(
                    context, match["name"], reason, self._caller_name or "a caller"
                )

        self._directory_routed = department_name
        self._call_summary_parts.append(f"Requested transfer to {department_name}: {reason}")
        directories = self._config.get("directories", [])

        matched = None
        for d in directories:
            if d.get("name", "").lower() == department_name.lower():
                matched = d
                break
        if not matched:
            for d in directories:
                if department_name.lower() in d.get("name", "").lower():
                    matched = d
                    break

        if matched:
            action = matched.get("phone_or_action", "")
            if action and any(c.isdigit() for c in action):
                self._outcome = "transferred"
                return f"I'll connect you to {department_name} now. Their number is {action}. Please hold while I transfer you."
            else:
                return f"The {department_name} department is currently set to: {action}. Let me take a message for them instead."
        else:
            available = ", ".join([d.get("name", "") for d in directories]) if directories else "none configured"
            return f"I don't have a '{department_name}' department listed. Available departments are: {available}. Would you like me to take a message instead?"

    @function_tool
    async def take_message(
        self, context: RunContext, caller_name: str, caller_phone: str, message: str, urgency: str = "normal"
    ):
        """Take a message from the caller when no one is available.

        Args:
            caller_name: The caller's name
            caller_phone: The caller's phone number or callback number
            message: The message they want to leave
            urgency: How urgent (normal, urgent, emergency)
        """
        self._caller_name = caller_name
        self._caller_phone = caller_phone
        self._messages_taken.append({
            "name": caller_name,
            "phone": caller_phone,
            "message": message,
            "urgency": urgency,
        })
        self._call_summary_parts.append(f"Message taken from {caller_name} ({caller_phone}): {message} [{urgency}]")
        self._outcome = "message_taken"

        return (
            f"I've taken down your message. To confirm: {caller_name} at {caller_phone}, "
            f"message: '{message}', marked as {urgency}. Someone will get back to you "
            f"as soon as possible. Is there anything else I can help with?"
        )

    @function_tool
    async def get_business_hours(self, context: RunContext):
        """Get the business hours. Use when a caller asks about hours of operation."""
        notes = self._config.get("general_notes", "")
        if any(kw in notes.lower() for kw in ["hours", "open", "close", "monday", "tuesday"]):
            return f"Based on our records: {notes}"
        return "I don't have the exact business hours on file right now. Would you like me to take a message and have someone call you back with that information?"

    @function_tool
    async def schedule_callback(
        self, context: RunContext, caller_name: str, caller_phone: str, preferred_time: str, reason: str
    ):
        """Schedule a callback request.

        Args:
            caller_name: The caller's name
            caller_phone: The caller's phone number
            preferred_time: When they'd like to be called back
            reason: What they need help with
        """
        self._caller_name = caller_name
        self._caller_phone = caller_phone
        self._messages_taken.append({
            "name": caller_name,
            "phone": caller_phone,
            "message": f"Callback requested: {reason}. Preferred time: {preferred_time}",
            "urgency": "normal",
        })
        self._call_summary_parts.append(f"Callback requested by {caller_name}: {reason} at {preferred_time}")
        self._outcome = "callback_scheduled"

        return (
            f"I've scheduled a callback request for {caller_name} at {caller_phone}. "
            f"They'll call you back around {preferred_time} regarding {reason}. "
            f"Is there anything else?"
        )

    @function_tool
    async def end_call(self, context: RunContext, farewell: str = ""):
        """End the call gracefully after saying goodbye.

        Args:
            farewell: Optional farewell message to say before ending
        """
        self._call_summary_parts.append("Call ended by agent")
        if farewell:
            return farewell
        return "Thank you for calling! Have a great day. Goodbye!"


async def run_secretary_session(ctx: JobContext, vad):
    """Entrypoint for the roofer-secretary agent — called from main.py."""
    call_start = time.time()

    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    # Load customer configuration (room metadata + API)
    config = await get_agent_config(ctx)
    customer_id = config.get("customer_id")

    logger.info(
        f"Starting secretary session: room={ctx.room.name}, "
        f"customer_id={customer_id}, transfer_enabled={config.get('transfer_enabled')}"
    )

    # Build the voice pipeline — optimized for LOW LATENCY + FASTER SPEECH
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="en"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        ),
        turn_detection=MultilingualModel(),
        vad=vad,
        preemptive_generation=True,
    )

    agent = RooferSecretaryAgent(config, call_start, ctx)

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=lambda params: (
                    noise_cancellation.BVCTelephony()
                    if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                    else noise_cancellation.BVC()
                ),
            ),
        ),
    )

    await ctx.connect()
    logger.info(f"Agent connected: room={ctx.room.name}")

    # Extract caller phone from SIP attributes
    caller_phone = "Unknown"
    for p in ctx.room.remote_participants.values():
        attrs = p.attributes or {}
        phone = attrs.get("sip.phoneNumber", "")
        if phone:
            caller_phone = phone
            agent._caller_phone = phone
            break

    # Create the initial call log entry so we have a call_log_id for transcript chunks
    if customer_id:
        call_log_id = await log_call_complete(
            customer_id=customer_id,
            caller_phone=caller_phone,
            caller_name="Unknown",
            duration_seconds=0,
            directory_routed="",
            summary="Call in progress",
            transcript="",
            outcome="in_progress",
            room_id=ctx.room.name,
        )
        agent._call_log_id = call_log_id
        logger.info(f"Created call log entry: id={call_log_id}")

    # Track which SIP participants are in the room
    sip_participants = set()
    for p in ctx.room.remote_participants.values():
        if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            sip_participants.add(p.identity)

    @ctx.room.on("participant_connected")
    def on_participant_joined(participant):
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            sip_participants.add(participant.identity)
            logger.info(f"SIP participant joined: {participant.identity} (total: {len(sip_participants)})")
            # If employee joins, capture their audio for transcript diarization
            if participant.identity.startswith("employee-"):
                agent._post_transfer_lines.append(f"[{participant.name or participant.identity} joined the call]")

    @ctx.room.on("participant_disconnected")
    def on_participant_left(participant):
        if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            return

        sip_participants.discard(participant.identity)
        logger.info(f"SIP participant left: {participant.identity} (remaining: {len(sip_participants)})")

        # If in ghost mode and an employee/caller left, check if room should end
        if agent._is_ghost_mode:
            # If only one or zero SIP participants left, the human conversation is over
            if len(sip_participants) <= 1:
                logger.info("Post-transfer call ended — all parties disconnected")
                agent._stop_heartbeat()
                agent._is_ghost_mode = False
                _finalize_call(agent, customer_id, caller_phone, call_start, ctx)
            return

        # Normal (non-transfer) call end — caller hung up
        if not agent._is_ghost_mode:
            _finalize_call(agent, customer_id, caller_phone, call_start, ctx)

    def _finalize_call(agent, customer_id, caller_phone, call_start, ctx):
        duration = int(time.time() - call_start)
        summary = "; ".join(agent._call_summary_parts) if agent._call_summary_parts else "General inquiry"
        transcript = "\n".join(agent._transcript_lines) if agent._transcript_lines else ""

        logger.info(
            f"Call finalized: room={ctx.room.name}, duration={duration}s, "
            f"caller={caller_phone}, outcome={agent._outcome}"
        )

        if customer_id and agent._call_log_id:
            pre_transcript = "\n".join(agent._pre_transfer_lines) if agent._pre_transfer_lines else ""
            post_transcript = "\n".join(agent._post_transfer_lines) if agent._post_transfer_lines else ""

            # Update the existing call log with final data
            asyncio.create_task(_api_post("/api/secretary/webhook/call-complete", {
                "customer_id": customer_id,
                "caller_phone": caller_phone,
                "caller_name": agent._caller_name or "Unknown",
                "duration_seconds": duration,
                "directory_routed": agent._directory_routed,
                "summary": summary,
                "transcript": transcript,
                "outcome": agent._outcome,
                "room_id": ctx.room.name,
                "call_log_id": agent._call_log_id,
                "pre_transfer_transcript": pre_transcript,
                "post_transfer_transcript": post_transcript,
                "transfer_happened": agent._is_post_transfer,
            }))
        elif customer_id:
            asyncio.create_task(log_call_complete(
                customer_id=customer_id,
                caller_phone=caller_phone,
                caller_name=agent._caller_name or "Unknown",
                duration_seconds=duration,
                directory_routed=agent._directory_routed,
                summary=summary,
                transcript=transcript,
                outcome=agent._outcome,
                room_id=ctx.room.name,
            ))
