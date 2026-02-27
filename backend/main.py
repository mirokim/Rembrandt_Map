"""
main.py — Phase 1

FastAPI application entry point.

Startup sequence:
    1. Electron spawns: python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765
    2. Uvicorn logs "Application startup complete" → Electron sets backendReady = true
    3. Frontend receives 'backend:ready' IPC event → window.backendAPI becomes usable

CORS: allow_origins=["*"] so the Electron file:// origin and Vite dev server both work.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routes.health import router as health_router
from backend.routes.documents import router as documents_router

app = FastAPI(
    title="Rembrandt MAP Backend",
    description="FastAPI + ChromaDB + LangChain RAG server for Rembrandt MAP",
    version="0.1.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # file:// origin (Electron) + Vite dev server
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(health_router)
app.include_router(documents_router)
