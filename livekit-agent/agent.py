"""
RoofReporterAI — Roofer Secretary AI Voice Agent
Powered by LiveKit Agents + LiveKit Inference

This agent answers inbound phone calls for roofing businesses.
It uses the customer's configured greeting, Q&A, and directory routing
to provide a professional AI receptionist experience.

Flow:
  1. Inbound call hits LiveKit phone number
  2. Dispatch rule routes call to a new room
  3. This agent joins the room and greets the caller
  4. Agent handles Q&A, routes to departments, takes messages
  5. After call, logs the call details to the RoofReporterAI API
"""

import os
import json
import logging
from dotenv import load_dotenv
from livekit.agents import (
    JobContext, JobProcess, Agent, AgentSession, AgentServer,
    cli, inference, function_tool, RoomInputOptions
)
from livekit.plugins import silero

load_dotenv()

logger = logging.getLogger("roofer-secretary")
logger.setLevel(logging.INFO)

# ============================================================
# Configuration loader — pulls config from room metadata
# or falls back to environment defaults
# ============================================================
def get_agent_config(ctx: JobContext) -> dict:
    """Extract customer config from room metadata or SIP participant metadata."""
    config = {
        "customer_id": None,
        "business_phone": "",
        "greeting_script": "Thank you for calling! How can I help you today?",
        "common_qa": "",
        "general_notes": "",
        "directories": [],
        "agent_name": "Sarah",
        "agent_voice": "alloy",
    }

    # Try to get config from room metadata (set by dispatch rule or API)
    room_metadata = ctx.room.metadata
    if room_metadata:
        try:
            meta = json.loads(room_metadata)
            config.update({k: v for k, v in meta.items() if k in config})
            logger.info(f"Loaded config from room metadata: customer_id={config.get('customer_id')}")
        except json.JSONDecodeError:
            logger.warning("Failed to parse room metadata as JSON")

    # Also check SIP participant metadata
    for participant in ctx.room.remote_participants.values():
        if participant.attributes and participant.attributes.get("sip.trunkPhoneNumber"):
            logger.info(f"SIP caller detected: {participant.attributes}")

    # Use env defaults if no room config
    if not config["greeting_script"] or config["greeting_script"] == "Thank you for calling! How can I help you today?":
        env_greeting = os.environ.get("DEFAULT_GREETING", "")
        if env_greeting:
            config["greeting_script"] = env_greeting

    return config


def build_system_prompt(config: dict) -> str:
    """Build the agent's system prompt from the customer's configuration."""
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
- You are on a PHONE CALL. Keep responses brief and natural.
- Always listen carefully to what the caller says before responding.
- If you don't understand, politely ask them to repeat.
- If you can answer from the Q&A below, do so confidently.
- If the caller wants to reach a specific department, use the transfer_to_department tool.
- If you can't help, offer to take a message using the take_message tool.
- Never reveal that you are an AI unless directly asked. If asked, say "I'm an AI assistant helping answer calls."
- Be empathetic and professional at all times.

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
# The Voice Agent — handles inbound calls
# ============================================================
class RooferSecretaryAgent(Agent):
    """AI receptionist that answers calls for roofing businesses."""

    def __init__(self, config: dict) -> None:
        self._config = config
        self._caller_name = ""
        self._caller_phone = ""
        self._call_summary = ""
        self._directory_routed = ""
        self._messages_taken = []

        super().__init__(
            instructions=build_system_prompt(config)
        )

    async def on_enter(self):
        """Called when the agent enters the session — greet the caller."""
        greeting = self._config.get("greeting_script", "Thank you for calling! How can I help you today?")
        self.session.generate_reply(instructions=f"Greet the caller with this exact greeting (adapt slightly to sound natural): {greeting}")

    @function_tool
    async def transfer_to_department(self, department_name: str, reason: str):
        """Transfer the caller to a specific department. Use this when the caller wants to reach Sales, Service, Parts, or another department.

        Args:
            department_name: The name of the department to transfer to (e.g., "Sales", "Service", "Parts")
            reason: Brief reason for the transfer
        """
        self._directory_routed = department_name
        directories = self._config.get("directories", [])

        # Find the matching directory
        matched = None
        for d in directories:
            if d.get("name", "").lower() == department_name.lower():
                matched = d
                break

        if not matched:
            # Try partial match
            for d in directories:
                if department_name.lower() in d.get("name", "").lower():
                    matched = d
                    break

        if matched:
            action = matched.get("phone_or_action", "")
            if action and any(c.isdigit() for c in action):
                # It's a phone number — tell the caller we're transferring
                return f"I'll connect you to {department_name} now. Their number is {action}. Please hold while I transfer you."
            else:
                # It's an action like "take a message"
                return f"The {department_name} department is currently set to: {action}. Let me take a message for them instead."
        else:
            available = ", ".join([d.get("name", "") for d in directories]) if directories else "none configured"
            return f"I don't have a '{department_name}' department listed. Available departments are: {available}. Would you like me to take a message instead?"

    @function_tool
    async def take_message(self, caller_name: str, caller_phone: str, message: str, urgency: str = "normal"):
        """Take a message from the caller when no one is available to take the call.

        Args:
            caller_name: The caller's name
            caller_phone: The caller's phone number or callback number
            message: The message they want to leave
            urgency: How urgent the message is (normal, urgent, emergency)
        """
        self._caller_name = caller_name
        self._caller_phone = caller_phone
        self._messages_taken.append({
            "name": caller_name,
            "phone": caller_phone,
            "message": message,
            "urgency": urgency,
        })

        return f"I've taken down your message. To confirm: {caller_name} at {caller_phone}, message: '{message}', marked as {urgency}. Someone will get back to you as soon as possible. Is there anything else I can help with?"

    @function_tool
    async def get_business_hours(self):
        """Get the business hours. Use this when a caller asks about hours of operation."""
        notes = self._config.get("general_notes", "")
        if "hours" in notes.lower() or "open" in notes.lower() or "close" in notes.lower():
            return f"Based on our records: {notes}"
        return "I don't have the exact business hours on file right now. Would you like me to take a message and have someone call you back with that information?"

    @function_tool
    async def schedule_callback(self, caller_name: str, caller_phone: str, preferred_time: str, reason: str):
        """Schedule a callback request when the caller wants someone to call them back.

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
            "message": f"Callback requested for: {reason}. Preferred time: {preferred_time}",
            "urgency": "normal",
        })

        return f"I've scheduled a callback request for {caller_name} at {caller_phone}. They'll call you back around {preferred_time} regarding {reason}. Is there anything else?"


# ============================================================
# Agent Server — lifecycle management
# ============================================================
server = AgentServer()


def prewarm(proc: JobProcess):
    """Preload VAD model once per process for faster connections."""
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    """Main entrypoint — called for each inbound call."""
    ctx.log_context_fields = {"room": ctx.room.name}

    # Load customer configuration from room/participant metadata
    config = get_agent_config(ctx)

    logger.info(f"Starting secretary session for room={ctx.room.name}, customer_id={config.get('customer_id')}")

    # Create the voice pipeline session
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3-general"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            # Professional female voice
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        ),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    # Create the agent with the customer's config
    agent = RooferSecretaryAgent(config)

    # Start the session
    await session.start(agent=agent, room=ctx.room)
    await ctx.connect()

    logger.info(f"Agent connected to room {ctx.room.name}")

    # Log call completion when the session ends
    @ctx.room.on("participant_disconnected")
    def on_participant_left(participant):
        logger.info(f"Participant {participant.identity} left room {ctx.room.name}")
        # Here you could POST call details back to the RoofReporterAI API
        # to log the call in the secretary_call_logs table


if __name__ == "__main__":
    cli.run_app(server)
