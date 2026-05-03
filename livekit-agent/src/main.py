"""
Roof Manager — Unified LiveKit Agent Server
=============================================
Single AgentServer hosting all 3 voice agents, routed by room name pattern:
  1. roofer-secretary  — Inbound AI receptionist (room: secretary-*)
  2. report-guide      — Interactive report explainer (room: report-guide-*)
  3. outbound-caller   — Outbound cold calling agent (room: sales-* or outbound-*)

Deploy to LiveKit Cloud:
  lk agent deploy --yes .
"""

import os
import json
import logging
import asyncio
import re

from livekit import rtc
from livekit.agents import (
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
)
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

# Import agent classes and session runners from modules
from agent import run_secretary_session
from report_guide_agent import run_report_guide_session
from outbound_agent import OutboundSalesAgent, post_call_results

logger = logging.getLogger("roof-manager-agents")
logger.setLevel(logging.INFO)

API_BASE = os.environ.get("ROOFPORTER_API_URL", "https://www.roofmanager.ca")

# ============================================================
# Shared Agent Server
# ============================================================
server = AgentServer()


def prewarm(proc: JobProcess):
    """Preload VAD model once per worker process (shared by all agents)."""
    proc.userdata["vad"] = silero.VAD.load()
    logger.info("VAD model preloaded")


server.setup_fnc = prewarm


# ============================================================
# Unified entrypoint — routes to correct agent by room name
# ============================================================
@server.rtc_session()
async def entrypoint(ctx: JobContext):
    """Route to the correct agent based on room name pattern."""
    room_name = ctx.room.name
    vad = ctx.proc.userdata["vad"]

    logger.info(f"New session: room={room_name}")

    # Route: secretary-{customerId}-{uuid} → Roofer Secretary
    if room_name.startswith("secretary-"):
        logger.info(f"[Secretary] Routing to roofer-secretary agent")
        await run_secretary_session(ctx, vad)
        return

    # Route: report-guide-{orderId} → Report Guide
    if room_name.startswith("report-guide-"):
        logger.info(f"[Report Guide] Routing to report-guide agent")
        await run_report_guide_session(ctx, vad)
        return

    # Route: sales-* or outbound-* → Outbound Cold Caller
    if room_name.startswith("sales-") or room_name.startswith("outbound-"):
        logger.info(f"[Outbound] Routing to outbound-caller agent")
        await run_outbound_session(ctx, vad)
        return

    # Fallback: check job/room metadata for agent_name hint.
    # CreateDispatch delivers metadata to ctx.job.metadata; RoomService/CreateRoom
    # delivers it to ctx.room.metadata. Try both.
    agent_name = None
    raw_meta = ""
    if ctx.job and getattr(ctx.job, "metadata", None):
        raw_meta = ctx.job.metadata
    elif ctx.room.metadata:
        raw_meta = ctx.room.metadata
    if raw_meta:
        try:
            meta = json.loads(raw_meta)
            agent_name = meta.get("agent_name") or meta.get("agent")
        except:
            pass

    if agent_name == "outbound-caller":
        logger.info(f"[Outbound] Routing via metadata agent_name")
        await run_outbound_session(ctx, vad)
        return
    elif agent_name == "report-guide":
        logger.info(f"[Report Guide] Routing via metadata agent_name")
        await run_report_guide_session(ctx, vad)
        return

    # Default: secretary
    logger.info(f"[Secretary] Default routing for room: {room_name}")
    await run_secretary_session(ctx, vad)


# ============================================================
# Outbound session runner (inline — wires up agent + SIP)
# ============================================================
async def run_outbound_session(ctx: JobContext, vad):
    """Run the outbound cold calling agent session."""
    # Parse metadata from dispatch (prospect info + script).
    # CreateDispatch delivers metadata to ctx.job.metadata; RoomService/CreateRoom
    # delivers it to ctx.room.metadata. Prefer job metadata, fall back to room.
    metadata = {}
    raw_meta = ""
    if ctx.job and getattr(ctx.job, "metadata", None):
        raw_meta = ctx.job.metadata
    if not raw_meta and ctx.room.metadata:
        raw_meta = ctx.room.metadata
    if raw_meta:
        try:
            metadata = json.loads(raw_meta)
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

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="en"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice="79a125e8-cd45-4c13-8a67-188112f4dd22",
        ),
        turn_detection=MultilingualModel(),
        vad=vad,
        preemptive_generation=True,
    )

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
    logger.info(f"[Outbound] Agent ready — room={ctx.room.name}, company={prospect_info.get('company')}")

    # Track when the SIP callee actually joins so we can distinguish a real
    # "no answer" (callee picked up, didn't engage) from infrastructure
    # failure (Telnyx rejected, number unreachable, trunk auth, etc.).
    import time as _t
    sip_join_ts = {"v": 0.0}

    @ctx.room.on("participant_connected")
    def on_participant_joined(participant):
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            agent.callee_joined = True
            sip_join_ts["v"] = _t.monotonic()
            # Promote default 'failed' (infra error) → 'no_answer' (callee
            # answered but didn't engage / hung up before any tool-call set
            # a real outcome). Tool calls override from there.
            if agent.outcome == "failed":
                agent.outcome = "no_answer"
            logger.info(f"[Outbound] SIP callee joined: room={ctx.room.name}")

    # Handle call completion — post results to webhook
    @ctx.room.on("participant_disconnected")
    def on_participant_left(participant):
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            elapsed = _t.monotonic() - sip_join_ts["v"] if sip_join_ts["v"] else 0.0
            # If the SIP leg ends in <8s with zero talk time, this isn't a
            # real "no answer" — Telnyx rejected the outbound INVITE before
            # the callee's phone ever rang. Override so the UI/log reflects
            # reality. Real "no_answer" rings ~30s before timeout.
            if 0 < elapsed < 8 and agent.outcome == "no_answer":
                agent.outcome = "trunk_rejected"
                logger.warning(f"[Outbound] SIP leg ended in {elapsed:.1f}s — relabeling as trunk_rejected (room={ctx.room.name})")
            else:
                logger.info(f"[Outbound] SIP participant disconnected after {elapsed:.1f}s: room={ctx.room.name}")
            asyncio.create_task(post_call_results(agent, ctx.room.name))


if __name__ == "__main__":
    cli.run_app(server)
