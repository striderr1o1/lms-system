import uuid

MUX_NOT_CONFIGURED_DETAIL = "Mux is not configured yet. Follow docs/MUX.md."


class MuxNotConfigured(Exception):
    """Mux is intentionally unimplemented. Filling env vars does not enable it."""

    detail = MUX_NOT_CONFIGURED_DETAIL


def create_direct_upload(*, lesson_id: uuid.UUID, cors_origin: str) -> dict:
    """Create a Mux direct upload for a video lesson.

    The human implements this later. Video bytes must not pass through this server.

    Planned behavior:
    - POST https://api.mux.com/video/v1/uploads with basic auth
      (MUX_TOKEN_ID, MUX_TOKEN_SECRET).
    - new_asset_settings.playback_policy = ["signed"]
    - new_asset_settings.passthrough = str(lesson_id)
    - cors_origin = the frontend origin (passed in, from FRONTEND_ORIGIN)
    - Insert video_assets with status "waiting" and mux_upload_id.
    - Return the one-time upload URL for the browser (@mux/upchunk or Mux Uploader).

    This function always raises until that body exists.
    """
    del lesson_id, cors_origin
    raise MuxNotConfigured(MUX_NOT_CONFIGURED_DETAIL)


def sign_playback_token(*, playback_id: str | None, lesson_id: uuid.UUID) -> dict:
    """Sign a short-lived Mux playback JWT (RS256).

    The human implements this later. Do not invent a token here.

    Planned claims:
    - header kid = MUX_SIGNING_KEY_ID
    - sub = playback id
    - aud = "v" (video). Also sign aud "t" (thumbnail) and "s" (storyboard) if used.
    - exp = now + 2 to 6 hours
    - Return {"playback_id", "tokens": {"playback", "thumbnail", "storyboard"}}.

    Issue a token only after the route has checked enrollment, ownership, or admin.
    """
    del playback_id, lesson_id
    raise MuxNotConfigured(MUX_NOT_CONFIGURED_DETAIL)


def delete_asset(*, mux_asset_id: str) -> None:
    """DELETE https://api.mux.com/video/v1/assets/{mux_asset_id}.

    The human calls this when a lesson or course with a Mux asset is deleted,
    so unused videos do not count against the free-plan asset limit (about 10).
    Run it as a background task and log failures. Do not block the database
    delete on Mux, and do not pretend a delete succeeded.

    Not called today. Lesson and course delete only remove database rows.
    """
    del mux_asset_id
    raise MuxNotConfigured(MUX_NOT_CONFIGURED_DETAIL)


def verify_webhook_signature(*, raw_body: bytes, signature_header: str | None) -> None:
    """Verify the Mux-Signature header.

    The human implements this later. There is no HMAC here on purpose.

    Planned checks:
    - Header format t=<unix>,v1=<hex>.
    - HMAC-SHA256 over f"{timestamp}.{raw_body decoded as text}" using
      MUX_WEBHOOK_SECRET. Use the raw request body, not re-serialized JSON.
    - Compare with hmac.compare_digest.
    - Reject missing, stale (about five minutes), or mismatched signatures.
    """
    del raw_body, signature_header
    raise MuxNotConfigured(MUX_NOT_CONFIGURED_DETAIL)


def handle_webhook_event(*, event_id: str, event_type: str, data: dict) -> None:
    """Apply a verified Mux webhook.

    The human implements this later. Do not insert webhook_events until then.

    Planned behavior:
    - Insert webhook_events.id = event id. If it already exists, return and do nothing.
    - video.upload.asset_created: save mux_asset_id, set status processing.
    - video.asset.ready: save mux_playback_id and duration, set status ready.
    - video.asset.errored: set status errored and error_message.
    Match the lesson via passthrough or mux_upload_id. Return 200 quickly.
    """
    del event_id, event_type, data
    raise MuxNotConfigured(MUX_NOT_CONFIGURED_DETAIL)
