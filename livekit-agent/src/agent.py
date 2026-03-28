"""
RoofReporterAI — Roofer Secretary AI Voice Agent
Powered by LiveKit Agents v1.4 + LiveKit Inference

This agent answers inbound phone calls for roofing businesses.
It pulls the customer's configured greeting, Q&A, and directory routing
from the RoofReporterAI API, then delivers a professional AI receptionist
experience over the phone.

Flow:
  1. Inbound call hits LiveKit phone number (via SIP trunk)
  2. Dispatch rule routes call to a new room: secretary-{customerId}-{uuid}
  3. This agent auto-joins the room, fetches customer config from the API
  4. Agent greets caller, handles Q&A, routes to departments, takes messages
  5. After call ends, logs the call details back to the RoofReporterAI API
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
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
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
# API client — communicates with the RoofReporterAI Cloudflare app
# ============================================================
API_BASE = os.environ.get("ROOFPORTER_API_URL", "https://roofreporterai.com")


async def fetch_customer_config(customer_id: int) -> Optional[dict]:
    """Fetch secretary configuration for a customer from the API.
    
    Returns dict with: greeting_script, common_qa, general_notes, directories, etc.
    Returns None on failure (agent will use fallback defaults).
    """
    url = f"{API_BASE}/api/secretary/agent-config/{customer_id}"
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
    """POST call details back to RoofReporterAI for logging."""
    url = f"{API_BASE}/api/secretary/webhook/call-complete"
    payload = {
        "customer_id": customer_id,
        "caller_phone": caller_phone,
        "caller_name": caller_name,
        "duration_seconds": duration_seconds,
        "directory_routed": directory_routed,
        "summary": summary,
        "transcript": transcript,
        "outcome": outcome,
        "room_id": room_id,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    logger.info(f"Call log saved for customer {customer_id}")
                else:
                    body = await resp.text()
                    logger.warning(f"Call log failed: HTTP {resp.status} — {body}")
    except Exception as e:
        logger.error(f"Error logging call: {e}")


# ============================================================
# Config extraction — from room name, metadata, and API
# ============================================================
def extract_customer_id_from_room(room_name: str) -> Optional[int]:
    """Extract customer_id from room name pattern: secretary-{customerId}-{uuid}"""
    match = re.match(r"secretary-(\d+)-", room_name)
    if match:
        return int(match.group(1))
    # Also try: secretary-{customerId}
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

    # 3. Fetch full config from the RoofReporterAI API
    if config["customer_id"]:
        api_config = await fetch_customer_config(config["customer_id"])
        if api_config:
            # Merge API data — API takes precedence for business config
            if api_config.get("greeting_script"):
                config["greeting_script"] = api_config["greeting_script"]
            if api_config.get("common_qa"):
                config["common_qa"] = api_config["common_qa"]
            if api_config.get("general_notes"):
                config["general_notes"] = api_config["general_notes"]
            if api_config.get("directories"):
                config["directories"] = api_config["directories"]
            if api_config.get("business_phone"):
                config["business_phone"] = api_config["business_phone"]
            if api_config.get("agent_name"):
                config["agent_name"] = api_config["agent_name"]

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
- If the caller wants to reach a specific department, use the transfer_to_department tool.
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
"""
    return prompt


# ============================================================
# The Voice Agent
# ============================================================
class RooferSecretaryAgent(Agent):
    """AI receptionist that answers calls for roofing businesses."""

    def __init__(self, config: dict, call_start_time: float) -> None:
        self._config = config
        self._call_start_time = call_start_time
        self._caller_name = ""
        self._caller_phone = ""
        self._call_summary_parts: list[str] = []
        self._directory_routed = ""
        self._messages_taken: list[dict] = []
        self._outcome = "answered"

        super().__init__(
            instructions=build_system_prompt(config)
        )

    async def on_enter(self):
        """Called when the agent enters the session — greet the caller."""
        greeting = self._config.get("greeting_script", "Thank you for calling! How can I help you today?")
        self.session.generate_reply(
            instructions=f"Greet the caller with this greeting (adapt slightly to sound natural): {greeting}"
        )

    @function_tool
    async def transfer_to_department(
        self, context: RunContext, department_name: str, reason: str
    ):
        """Transfer the caller to a specific department or person.

        Args:
            department_name: The name of the department to transfer to (e.g., "Sales", "Service")
            reason: Brief reason for the transfer
        """
        self._directory_routed = department_name
        self._call_summary_parts.append(f"Requested transfer to {department_name}: {reason}")
        directories = self._config.get("directories", [])

        # Exact match first, then partial
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


# ============================================================
# Agent Server — lifecycle
# ============================================================
server = AgentServer()


def prewarm(proc: JobProcess):
    """Preload VAD model once per worker process."""
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="roofer-secretary")
async def entrypoint(ctx: JobContext):
    """Main entrypoint — called for each inbound call."""
    call_start = time.time()

    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    # Load customer configuration (room metadata + API)
    config = await get_agent_config(ctx)
    customer_id = config.get("customer_id")

    logger.info(
        f"Starting secretary session: room={ctx.room.name}, "
        f"customer_id={customer_id}"
    )

    # Build the voice pipeline — optimized for LOW LATENCY + FASTER SPEECH
    session = AgentSession(
        # STT: Deepgram Nova-3 for accurate phone audio transcription
        stt=inference.STT(model="deepgram/nova-3", language="en"),
        # LLM: GPT-4.1-mini for fast, smart responses
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        # TTS: Cartesia Sonic-3 — professional female voice, FASTER speaking
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        ),
        # Turn detection for natural conversation flow
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        # Allow LLM to start generating before user finishes for lower latency
        preemptive_generation=True,
    )

    # Create agent with customer config
    agent = RooferSecretaryAgent(config, call_start)

    # Start session with SIP-optimized noise cancellation
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

    # Connect to the room (joins the call)
    await ctx.connect()

    logger.info(f"Agent connected: room={ctx.room.name}")

    # Track caller phone from SIP attributes
    caller_phone = "Unknown"
    for p in ctx.room.remote_participants.values():
        attrs = p.attributes or {}
        phone = attrs.get("sip.phoneNumber", "")
        if phone:
            caller_phone = phone
            break

    # Handle call completion — log to RoofReporterAI
    @ctx.room.on("participant_disconnected")
    def on_participant_left(participant):
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            duration = int(time.time() - call_start)
            summary = "; ".join(agent._call_summary_parts) if agent._call_summary_parts else "General inquiry"

            logger.info(
                f"Call ended: room={ctx.room.name}, duration={duration}s, "
                f"caller={caller_phone}, outcome={agent._outcome}"
            )

            if customer_id:
                # Fire-and-forget the API call
                asyncio.create_task(
                    log_call_complete(
                        customer_id=customer_id,
                        caller_phone=caller_phone,
                        caller_name=agent._caller_name or "Unknown",
                        duration_seconds=duration,
                        directory_routed=agent._directory_routed,
                        summary=summary,
                        transcript="",  # Transcript collection requires additional setup
                        outcome=agent._outcome,
                        room_id=ctx.room.name,
                    )
                )


if __name__ == "__main__":
    cli.run_app(server)
