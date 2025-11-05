from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional
import os
import json
import uuid
from groq import Groq
from dotenv import load_dotenv

# ----------------------------
# Load environment variables
# ----------------------------
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("❌ GROQ_API_KEY not found in environment variables")

# Initialize Groq client
client = Groq(api_key=GROQ_API_KEY)

# ----------------------------
# Initialize FastAPI app
# ----------------------------
app = FastAPI()

# ✅ CORS must come AFTER app is defined
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # in prod, restrict to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Define Models
# ----------------------------
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None

class ChatResponse(BaseModel):
    session_id: str
    intent: str
    entities: Optional[Dict[str, Any]] = None
    reply: str

# ----------------------------
# Session memory
# ----------------------------
session_memory = {}

# ----------------------------
# System Prompt
# ----------------------------
SYSTEM_PROMPT = """
... your existing SYSTEM_PROMPT ...
"""

# ----------------------------
# Root route to avoid 404
# ----------------------------
@app.get("/")
async def root():
    return {"message": "Welcome to Mchat Backend API! Use /start to begin a chat."}

# ----------------------------
# Start chat
# ----------------------------
@app.get("/start", response_model=ChatResponse)
async def start_chat():
    session_id = str(uuid.uuid4())
    session_memory[session_id] = {"turns": 0, "greeted": True}
    return ChatResponse(
        session_id=session_id,
        intent="greeting",
        entities={},
        reply="Hello! I’m your healthcare assistant. How can I help you today?"
    )

# ----------------------------
# Chat endpoint
# ----------------------------
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())
    if session_id not in session_memory:
        session_memory[session_id] = {"turns": 0, "greeted": True}
        return ChatResponse(
            session_id=session_id,
            intent="greeting",
            entities={},
            reply="Hello! I’m your healthcare assistant. How can I help you today?"
        )

    session = session_memory[session_id]

    # End session after 5 turns
    if session["turns"] >= 5:
        del session_memory[session_id]
        return ChatResponse(
            session_id=session_id,
            intent="session_end",
            entities={},
            reply="Our session has ended. Please start a new chat if you need further help."
        )

    session["turns"] += 1

    # Call Groq API
    groq_reply = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": req.message},
        ],
        response_format={"type": "json_object"}
    )

    data = json.loads(groq_reply.choices[0].message.content)

    return ChatResponse(
        session_id=session_id,
        intent=data.get("intent", "unknown"),
        entities=data.get("entities", {}),
        reply=data.get("reply", "I'm here to help.")
    )
