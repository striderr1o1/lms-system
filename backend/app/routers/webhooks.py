from fastapi import APIRouter, HTTPException, Request, status

from app.services import mux
from app.services.mux import MuxNotConfigured

router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/mux")
async def mux_webhook(request: Request) -> None:
    raw = await request.body()
    signature = request.headers.get("Mux-Signature")
    try:
        mux.verify_webhook_signature(raw_body=raw, signature_header=signature)
    except MuxNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=exc.detail) from exc
