import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[2]          # AGENT-V3/
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from backend.app.api.routes import auth, chat, user

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "frontend"
ASSETS_DIR = FRONTEND_DIR / "assets"

app = FastAPI(title="Agentic AI Studio")

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(user.router)
app.include_router(chat.router)

app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")


@app.get("/", include_in_schema=False)
async def home():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/login", include_in_schema=False)
async def login_page():
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/signup", include_in_schema=False)
async def signup_page():
    return FileResponse(FRONTEND_DIR / "signup.html")


@app.get("/chat", include_in_schema=False)
async def chat_page():
    return FileResponse(FRONTEND_DIR / "chat.html")


@app.get("/api/health", tags=["health"])
async def health_check():
    return {"status": "ok", "service": "agentic-ai-studio"}
