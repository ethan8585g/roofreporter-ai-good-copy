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
        # Default to "failed" — if the SIP call never connected (Telnyx
        # rejected, number unreachable, trunk auth failed) on_close fires
        # with no callee in the room. Reporting "no_answer" in that case
        # masks infrastructure bugs as user-not-picking-up.
        # Once a callee participant joins the room we promote to "answered";
        # the call-flow tools (mark_interested, etc.) override from there.
        self.outcome = "failed"
        self.callee_joined = False
        self.had_conversation = False
        self.transcript_lines = []
        self.objections = []
        self.sentiment = "neutral"
        self.follow_up_action = ""
        self.follow_up_date = ""
        # Derive transcript-event endpoint from webhook_url so it lives on
        # the same origin as /call-complete.
        try:
            self.transcript_event_url = webhook_url.rsplit("/", 1)[0] + "/transcript-event"
            self.status_event_url = webhook_url.rsplit("/", 1)[0] + "/call-status"
        except Exception:
            self.transcript_event_url = f"{API_BASE}/api/call-center/transcript-event"
            self.status_event_url = f"{API_BASE}/api/call-center/call-status"
        self._room_name = ""

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

    def _on_participant_connected(self, participant):
        """Track when the SIP-dialed callee actually joins the room.
        Anyone other than the AI agent joining = the callee picked up."""
        ident = getattr(participant, "identity", "") or ""
        if ident.startswith("callee-") or "sip" in ident.lower():
            self.callee_joined = True
            # Promote default outcome from 'failed' (infra error) to 'no_answer'
            # — by the time on_close fires, this means: callee answered but
            # didn't engage / hung up before any tool-call outcome was set.
            if self.outcome == "failed":
                self.outcome = "no_answer"
            logger.info(f"Callee joined room: {ident}")
            # Promote DB call_status from 'ringing' → 'connected' so the
            # super-admin Live Call panel reflects the real state.
            asyncio.create_task(self._post_status("connected"))

    async def _post_status(self, status: str):
        """Fire-and-forget: update cc_call_logs.call_status mid-call."""
        if not self._room_name:
            return
        try:
            async with aiohttp.ClientSession() as s:
                await s.post(
                    self.status_event_url,
                    json={"room_name": self._room_name, "call_status": status},
                    timeout=aiohttp.ClientTimeout(total=5),
                )
        except Exception as e:
            logger.warning(f"status post failed: {e}")

    async def _post_transcript_line(self, role: str, text: str):
        """Fire-and-forget: stream a transcript line back to the worker."""
        if not self._room_name or not text:
            return
        try:
            async with aiohttp.ClientSession() as s:
                await s.post(
                    self.transcript_event_url,
                    json={
                        "room_name": self._room_name,
                        "role": role,
                        "text": text,
                        "ts": datetime.utcnow().isoformat() + "Z",
                    },
                    timeout=aiohttp.ClientTimeout(total=5),
                )
        except Exception as e:
            logger.warning(f"transcript post failed: {e}")

    def _on_conversation_item_added(self, ev):
        """Capture each utterance (user STT or agent TTS) as it lands in
        the chat context. LiveKit fires this event on the VoiceSession."""
        try:
            item = getattr(ev, "item", None) or ev
            role = getattr(item, "role", "") or ""
            content = getattr(item, "text_content", None)
            if callable(content):
                content = content()
            if not content:
                # ChatMessage in some LK versions exposes .content as list[str]
                raw = getattr(item, "content", "")
                if isinstance(raw, list):
                    content = " ".join(str(x) for x in raw if x)
                else:
                    content = str(raw or "")
            content = (content or "").strip()
            if not content:
                return
            display_role = "agent" if role == "assistant" else ("prospect" if role == "user" else role or "system")
            self.transcript_lines.append(f"[{display_role}] {content}")
            if role in ("user", "assistant"):
                self.had_conversation = True
            asyncio.create_task(self._post_transcript_line(display_role, content))
        except Exception as e:
            logger.warning(f"conversation_item_added handler error: {e}")

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

        # If a real conversation happened but no tool-call outcome was set,
        # don't mislabel the call as "no_answer". A connected call with
        # transcript content but no explicit interest/booking is "completed".
        if self.had_conversation and self.outcome in ("no_answer", "failed"):
            self.outcome = "completed"

        payload = {
            "room_name": self.session.room.name if self.session else self._room_name,
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
    agent._room_name = ctx.room.name if ctx.room else ""

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

    # Track when the SIP callee actually joins so on_close can distinguish
    # infrastructure failures from real "no answer" (callee answered but
    # never said anything before the room ended).
    ctx.room.on("participant_connected", agent._on_participant_connected)

    # End the agent immediately when the callee hangs up, so LiveKit doesn't
    # keep the room alive for empty_timeout (~5 min) and bill us for it.
    def _on_callee_disconnect(participant):
        if participant.identity.startswith("sip-"):
            logger.info(f"Callee {participant.identity} hung up — shutting down room")
            try:
                import asyncio
                asyncio.create_task(ctx.room.disconnect())
            except Exception as e:
                logger.warning(f"Failed to disconnect room on hangup: {e}")
    ctx.room.on("participant_disconnected", _on_callee_disconnect)

    # Live transcript: stream each user/agent utterance back to the worker
    # so the super-admin Live Call panel can render it in real time.
    try:
        session.on("conversation_item_added", agent._on_conversation_item_added)
    except Exception as e:
        logger.warning(f"Could not subscribe to conversation_item_added: {e}")

    await session.start(room=ctx.room)

    logger.info(f"Outbound agent ready — waiting for callee to join")


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="outbound-caller",
        )
    )
