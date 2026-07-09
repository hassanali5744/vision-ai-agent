import asyncio

from livekit import api
from livekit.api.twirp_client import TwirpError

from app import config


def _require_livekit_config() -> None:
    if not config.LIVEKIT_API_KEY:
        raise ValueError("LIVEKIT_API_KEY is not configured in backend/.env")
    if not config.LIVEKIT_API_SECRET:
        raise ValueError("LIVEKIT_API_SECRET is not configured in backend/.env")
    if not config.LIVEKIT_URL:
        raise ValueError("LIVEKIT_URL is not configured in backend/.env")


def create_participant_token(room: str, identity: str) -> str:
    _require_livekit_config()

    token = (
        api.AccessToken(
            api_key=config.LIVEKIT_API_KEY,
            api_secret=config.LIVEKIT_API_SECRET,
        )
        .with_identity(identity)
        .with_name(identity)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
    )

    jwt_token = token.to_jwt()
    if isinstance(jwt_token, bytes):
        jwt_token = jwt_token.decode("utf-8")
    return jwt_token


async def dispatch_agent_to_room(room: str) -> bool:
    """Dispatch the onboarding agent into the room. Returns True if a new dispatch was created."""
    _require_livekit_config()

    async with api.LiveKitAPI(
        url=config.LIVEKIT_URL,
        api_key=config.LIVEKIT_API_KEY,
        api_secret=config.LIVEKIT_API_SECRET,
    ) as lkapi:
        for attempt in range(5):
            try:
                existing = await lkapi.agent_dispatch.list_dispatch(room_name=room)
                if any(d.agent_name == config.LIVEKIT_AGENT_NAME for d in existing):
                    return False
            except TwirpError as error:
                if error.code != "not_found":
                    raise

            try:
                await lkapi.agent_dispatch.create_dispatch(
                    api.CreateAgentDispatchRequest(
                        agent_name=config.LIVEKIT_AGENT_NAME,
                        room=room,
                    )
                )
                return True
            except TwirpError as error:
                if attempt == 4 or error.code not in {"failed_precondition", "unavailable"}:
                    raise
                await asyncio.sleep(0.8)

        return False
