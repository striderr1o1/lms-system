# Mux (not connected)

Video bytes must not pass through this API. The browser uploads straight to Mux, Mux calls our webhook, and the API returns a short-lived signed playback token only after an access check.

At the time of the implementation plan, the Mux free plan allows about **10 video assets** and 100,000 delivery minutes per month. Delete test assets or the cap is used up before a demo. Confirm that signed playback is on your plan. If it is not, the plan says to use a public playback policy for the demo only.

Nothing in this repo calls Mux. There is no Mux Python package and no `@mux/mux-player-react` dependency. `backend/app/services/mux.py` raises `MuxNotConfigured` from every function. These routes return HTTP 501 with the detail `Mux is not configured yet. Follow docs/MUX.md.` after their own checks:

| Route | Checks that already run | Service function |
| --- | --- | --- |
| `POST /api/v1/teacher/lessons/{id}/video-upload` | Approved teacher, owns the lesson's course, lesson type is `video` | `create_direct_upload` |
| `GET /api/v1/lessons/{id}/playback` | Enrolled student on a published course, or the approved owning teacher, or an admin. Non-video lessons are HTTP 400. A `video_assets` row is not required yet. | `sign_playback_token` |
| `POST /api/v1/webhooks/mux` | Public. No user JWT. Does not insert `webhook_events`. | Calls `verify_webhook_signature` only. After that passes, call `handle_webhook_event`. |

Filling the env vars does not turn this on. Replace the function bodies. Do not proxy the file through FastAPI.

The `video_assets` table already exists (`lesson_id` unique, status `waiting | processing | ready | errored`).

## Environment

Set these in `backend/.env`. Leave them empty until the Mux dashboard gives you the values.

- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`
- `MUX_SIGNING_KEY_ID`
- `MUX_SIGNING_PRIVATE_KEY` (base64 private key from Mux)
- `MUX_WEBHOOK_SECRET`

`FRONTEND_ORIGIN` is already the CORS origin. Send that same origin to Mux as `cors_origin`.

## 1. Direct upload — `create_direct_upload`

Called by `POST /api/v1/teacher/lessons/{id}/video-upload` after the route has checked the teacher, ownership, and lesson type.

1. `POST https://api.mux.com/video/v1/uploads` with HTTP basic auth (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`).
2. JSON body:
   - `new_asset_settings.playback_policy = ["signed"]`
   - `new_asset_settings.passthrough = <lesson id>` so webhooks can be matched
   - `cors_origin = FRONTEND_ORIGIN`
3. Insert `video_assets` with `status = 'waiting'` and the Mux upload id.
4. Return the one-time upload URL to the browser.

The browser uploads the file to that URL (`@mux/upchunk` or Mux Uploader), with a progress bar. This server never reads the video bytes.

The course builder already lets a teacher save a video lesson. The file input is disabled and explains that Mux is connected later. When upload works, enable that control and poll until `video_assets.status` is `ready` (the plan suggests `GET` of the lesson every few seconds, or refetch on focus). Show "Processing..." until then.

## 2. Webhook — `verify_webhook_signature` and `handle_webhook_event`

Register this URL in the Mux dashboard:

`https://<public-host>/api/v1/webhooks/mux`

`POST /api/v1/webhooks/mux` stays public. No user JWT.

1. `verify_webhook_signature(raw_body, signature_header)`
   - Read the raw body. Do not verify a re-serialized JSON string.
   - Header `Mux-Signature` looks like `t=<unix>,v1=<hex>`.
   - Signed payload is `f"{timestamp}.{raw_body as text}"`.
   - HMAC-SHA256 with `MUX_WEBHOOK_SECRET`.
   - Compare with `hmac.compare_digest`.
   - Reject a missing header, a timestamp older than about five minutes, or a bad signature with HTTP 400.
2. `handle_webhook_event`
   - Insert the Mux event id into `webhook_events`. If that primary key already exists, return 200 and do nothing.
   - `video.upload.asset_created`: save `mux_asset_id`, set `status = processing`. Match on `mux_upload_id` or the passthrough lesson id.
   - `video.asset.ready`: save `mux_playback_id` and duration, set `status = ready`. Copy duration onto `lessons.duration_sec` so the existing 90% progress rule has a known length.
   - `video.asset.errored`: set `status = errored` and `error_message`.
   - Return 200 quickly. Keep the handler small.

The route today returns 501 and does not insert `webhook_events`. There is no HMAC implementation in the repo; do not leave a stub that reports success.

For local testing, expose the API with ngrok or cloudflared and register that URL as a temporary webhook.

## 3. Signed playback — `sign_playback_token`

Called by `GET /api/v1/lessons/{id}/playback` after the access check. Once Mux is real, also require `video_assets.status = ready`.

Sign an RS256 JWT with `MUX_SIGNING_PRIVATE_KEY`:

- Header `kid` = `MUX_SIGNING_KEY_ID`
- `sub` = playback id
- `aud` = `v` (video)
- `exp` = now + 2 to 6 hours

Sign separate tokens for a thumbnail (`aud = t`) and a storyboard (`aud = s`) if the player uses them.

Response shape:

```json
{
  "playback_id": "...",
  "tokens": {
    "playback": "...",
    "thumbnail": "...",
    "storyboard": "..."
  }
}
```

The lesson page currently shows the lesson title and a short note that playback is not connected. When tokens exist, render `@mux/mux-player-react` with `playbackId`, the tokens, and `startTime` from `last_position_sec`. Refetch the token if it expires during a long session. Do not add that package until this response is real.

The player should keep calling `POST /api/v1/lessons/{id}/progress` about every 10 to 15 seconds. That endpoint already marks a video complete when `is_completed` is true, or when `last_position_sec` is at least 90% of `lessons.duration_sec` and the duration is known. Text, link, and file lessons complete only from the Mark complete button.

## 4. Cleanup — `delete_asset`

Implement `DELETE https://api.mux.com/video/v1/assets/{mux_asset_id}`.

Call `delete_asset` when a lesson or course that has a `mux_asset_id` is deleted. Do it in a background task and log failures. A Mux outage should not block the database delete, and a failure should not be silent or you will hit the ~10 asset cap without noticing.

Today, delete routes only remove database rows. `delete_asset` raises `MuxNotConfigured` and is not called.

## 5. Player package

After the playback route returns tokens, add `@mux/mux-player-react` on the lesson page and remove the placeholder. Optional: pass a Mux Data environment key if you want playback-quality metrics. That is not required for the MVP.
