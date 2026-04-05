"""
Roof Manager — Outbound Cold Calling Agent
=============================================
LiveKit AI Agent for outbound sales calls.
Dispatched via AgentDispatch API with prospect info in metadata.
Dials prospect via CreateSIPParticipant, delivers sales script,
handles objections, and logs outcomes.

Deploy: lk agent create --yes . (with AGENT_NAME=outbound-caller)
"""

import os
import json
import asyncio
import logging
import aiohttp
from datetime import datetime
from livekit.agents import (
    Agent,
    AgentSession,
    ChatContext,
    ChatMessage,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.agents.voice import VoiceSession
from livekit.plugins import deepgram, openai, cartesia, silero, noise_cancellation

logger = logging.getLogger("outbound-agent")
logger.setLevel(logging.INFO)

API_BASE = os.environ.get("ROOFPORTER_API_URL", "https://www.roofmanager.ca")


class OutboundSalesAgent(Agent):
    """AI cold calling agent for roofing company outreach."""

    def __init__(self, prospect_info: dict, script: dict, webhook_url: str):
        self.prospect = prospect_info
        self.script = script or {}
        self.webhook_url = webhook_url
        self.call_start = None
        self.talk_start = None
        self.is_voicemail = False
        self.outcome = "no_answer"
        self.transcript_lines = []
        self.objections = []
        self.sentiment = "neutral"
        self.follow_up_action = ""
        self.follow_up_date = ""

        company = prospect_info.get("company", "your company")
        contact = prospect_info.get("contact", "")
        intro = script.get("script_intro", f"Hi, this is calling from Roof Manager. Am I speaking with someone from {company}?")
        value_prop = script.get("script_value_prop", "We help roofing contractors generate accurate roof measurement reports from satellite imagery in under 60 seconds, with a full CRM built in.")
        objections_json = script.get("script_objections", "")
        closing = script.get("script_closing", "Would you be open to a quick 5-minute demo to see how it works for your business?")
        voicemail_script = script.get("script_voicemail", f"Hi, this is a quick message for {company}. We're reaching out from Roof Manager — we help roofing contractors generate satellite roof measurement reports in 60 seconds. Visit roofmanager.ca for 3 free reports. Thanks!")

        objection_handling = ""
        if objections_json:
            try:
                objections = json.loads(objections_json) if isinstance(objections_json, str) else objections_json
                if isinstance(objections, dict):
                    objection_handling = "\n".join([f"- If they say '{k}': {v}" for k, v in objections.items()])
                elif isinstance(objections, list):
                    objection_handling = "\n".join([f"- {obj}" for obj in objections])
            except:
                objection_handling = str(objections_json)

        instructions = f"""You are a professional, friendly sales representative for Roof Manager, an AI-powered roof measurement and CRM platform for roofing companies.

You are making an OUTBOUND cold call to: {company}{f' (contact: {contact})' if contact else ''}.

CALL FLOW:
1. INTRODUCTION: {intro}
2. VALUE PROPOSITION: {value_prop}
3. HANDLE OBJECTIONS: Be understanding, never pushy. {objection_handling}
4. CLOSE: {closing}

VOICEMAIL SCRIPT (if you detect voicemail):
{voicemail_script}

RULES:
- Be warm, professional, and conversational — NOT robotic
- Keep responses SHORT (1-2 sentences max unless explaining a feature)
- If the person is busy, offer to call back at a better time
- If they're not interested, thank them politely and end the call
- If they're interested, try to book a demo or get them to sign up at roofmanager.ca
- NEVER be aggressive, pushy, or argue
- If asked "are you a robot?" — say "I'm an AI assistant calling on behalf of Roof Manager. Would you prefer to speak with a human? I can arrange that."
- Track sentiment: positive, neutral, negative
- Note any objections raised for the call report

VOICEMAIL DETECTION:
- If you hear "leave a message", "at the tone", "not available", "mailbox" — deliver the voicemail script then end the call
- If no one speaks for 8+ seconds after connection — assume voicemail, deliver script, end call
"""

        super().__init__(instructions=instructions)
        self._voicemail_script = voicemail_script

    async def on_enter(self):
        """Called when agent enters the session."""
        self.call_start = datetime.utcnow()
        logger.info(f"Outbound agent entered room for {self.prospect.get('company', 'unknown')}")

    @function_tool("book_appointment")
    async def book_appointment(self, date: str = "", time: str = "", notes: str = ""):
        """Book a demo or appointment with the prospect. Call this when they agree to a meeting."""
        self.outcome = "demo_scheduled"
        self.follow_up_action = "demo_booked"
        self.follow_up_date = date or ""
        logger.info(f"Appointment booked: {date} {time} - {notes}")
        return f"I've noted that appointment for {date or 'a time to be confirmed'}. We'll send a confirmation. Thank you!"

    @function_tool("mark_interested")
    async def mark_interested(self, interest_level: str = "warm", notes: str = ""):
        """Mark this prospect as interested. Call when they show genuine interest."""
        self.outcome = "interested"
        self.sentiment = "positive"
        logger.info(f"Prospect interested: {interest_level} - {notes}")
        return "Noted their interest."

    @function_tool("mark_not_interested")
    async def mark_not_interested(self, reason: str = ""):
        """Mark when prospect clearly says they're not interested."""
        self.outcome = "not_interested"
        self.sentiment = "negative"
        if reason:
            self.objections.append(reason)
        return "Understood. Thank them and end the call politely."

    @function_tool("request_callback")
    async def request_callback(self, preferred_time: str = "", reason: str = ""):
        """Prospect wants us to call back at a different time."""
        self.outcome = "callback_requested"
        self.follow_up_action = "callback"
        self.follow_up_date = preferred_time or ""
        return f"I'll schedule a callback{' for ' + preferred_time if preferred_time else ' at a better time'}. Thank you!"

    @function_tool("transfer_to_human")
    async def transfer_to_human(self):
        """Transfer the call to a human representative when requested."""
        self.outcome = "transfer_requested"
        self.follow_up_action = "transfer"
        return "Let me connect you with a team member. One moment please."

    async def on_close(self):
        """Called when agent session ends. Post results to webhook."""
        duration = 0
        if self.call_start:
            duration = int((datetime.utcnow() - self.call_start).total_seconds())

        transcript = "\n".join(self.transcript_lines) if self.transcript_lines else ""

        payload = {
            "room_name": self.session.room.name if self.session else "",
            "call_status": "completed",
            "call_outcome": self.outcome,
            "call_duration_seconds": duration,
            "talk_time_seconds": max(0, duration - 5),  # rough estimate
            "call_summary": f"Outbound call to {self.prospect.get('company', 'unknown')}. Outcome: {self.outcome}.",
            "call_transcript": transcript,
            "caller_sentiment": self.sentiment,
            "objections_raised": ", ".join(self.objections) if self.objections else "",
            "follow_up_action": self.follow_up_action,
            "follow_up_date": self.follow_up_date,
            "prospect_id": self.prospect.get("prospect_id"),
            "agent_id": self.prospect.get("agent_id"),
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.webhook_url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    logger.info(f"Call complete webhook: {resp.status}")
        except Exception as e:
            logger.error(f"Webhook failed: {e}")


async def entrypoint(ctx: RunContext):
    """Main entrypoint — dispatched by AgentDispatch API."""
    logger.info(f"Outbound agent starting in room: {ctx.room.name}")

    # Parse metadata from dispatch
    metadata = {}
    if ctx.job and ctx.job.metadata:
        try:
            metadata = json.loads(ctx.job.metadata)
        except:
            metadata = {}

    prospect_info = {
        "prospect_id": metadata.get("prospect_id"),
        "agent_id": metadata.get("agent_id"),
        "agent_name": metadata.get("agent_name", "Sales Agent"),
        "phone": metadata.get("phone", ""),
        "company": metadata.get("company", ""),
        "contact": metadata.get("contact", ""),
    }

    script = metadata.get("script", {})
    if isinstance(script, str):
        try:
            script = json.loads(script)
        except:
            script = {}

    webhook_url = metadata.get("webhook_url", f"{API_BASE}/api/call-center/call-complete")

    agent = OutboundSalesAgent(prospect_info, script, webhook_url)

    session = VoiceSession(
        agent=agent,
        stt=deepgram.STT(model="nova-3", language="en"),
        llm=openai.LLM(model="gpt-4.1-mini"),
        tts=cartesia.TTS(
            model="sonic-3",
            voice="79a125e8-cd45-4c13-8a67-188112f4dd22",  # Professional female voice
        ),
        vad=silero.VAD.load(),
        chat_ctx=ChatContext(),
    )

    # Enable noise cancellation for telephony
    session.plugins.append(noise_cancellation.NoiseCancellation())

    await session.start(room=ctx.room)

    logger.info(f"Outbound agent ready — waiting for callee to join")


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="outbound-caller",
        )
    )
