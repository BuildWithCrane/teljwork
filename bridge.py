# on render
from fastapi import FastAPI, UploadFile, Header, HTTPException, File
import os, tempfile, httpx

app = FastAPI()

BOT_TOKEN = os.environ["BOT_TOKEN"]
CHAT_ID   = os.environ["CHAT_ID"].strip()
SECRET    = os.environ["BRIDGE_SECRET"]

TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

@app.get("/")
async def root():
    return {"ok": True, "service": "upload-bridge"}

@app.get("/health")
async def health():
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{TG_API}/getMe")
        return {"ok": r.status_code == 200, "tg_connected": r.status_code == 200}

@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    x_bridge_secret: str = Header(None),
    x_user_email: str = Header(None),
):
    if not x_bridge_secret or x_bridge_secret != SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    filename = file.filename or "upload"

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{filename}") as tmp:
            tmp_path = tmp.name
            while chunk := await file.read(1024 * 1024):
                tmp.write(chunk)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to buffer file: {str(e)}")

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            with open(tmp_path, "rb") as f:
                r = await client.post(
                    f"{TG_API}/sendDocument",
                    data={
                        "chat_id": CHAT_ID,
                        "caption": f"👤 {x_user_email or 'unknown'}\n📁 {filename}",
                    },
                    files={"document": (filename, f, "application/octet-stream")},
                )
        data = r.json()
        if not data.get("ok"):
            raise HTTPException(status_code=502, detail=f"Telegram error: {data.get('description')}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Request error: {type(e).__name__}: {str(e)}")
    finally:
        os.unlink(tmp_path)

    msg = data["result"]
    doc = msg.get("document") or msg.get("video") or msg.get("audio") or msg.get("photo")
    if not doc:
        raise HTTPException(status_code=502, detail="Telegram returned no document")

    if isinstance(doc, list):
        doc = doc[-1]

    return {
        "ok": True,
        "message_id": msg["message_id"],
        "file_id": doc["file_id"],
    }
