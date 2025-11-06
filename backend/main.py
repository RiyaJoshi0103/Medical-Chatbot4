from fastapi import FastAPI, Query
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

# ✅ Correct CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    language: Optional[str] = "en"

class ChatResponse(BaseModel):
    session_id: str
    intent: str
    entities: Optional[Dict[str, Any]] = None
    reply: str

# ----------------------------
# Session memory (temporary store)
# ----------------------------
session_memory = {}

# ----------------------------
# System Prompt for Groq LLM
# ----------------------------
SYSTEM_PROMPT = """
You are a medical symptom triage assistant for a hospital system.
You help users understand their symptoms, suggest possible causes,
and provide guidance on whether they should see a doctor.
"""

# ----------------------------
# Root / health check route
# ----------------------------
@app.get("/")
def root():
    return {"message": "Backend is live"}

# ----------------------------
# Start new chat session with language support
# ----------------------------
@app.get("/start", response_model=ChatResponse)
async def start_chat(language: str = Query("en")):
    session_id = str(uuid.uuid4())
    session_memory[session_id] = {"turns": 0, "greeted": True}

    language = language.lower()
    greeting = (
        "Hello! I’m your healthcare assistant. How can I help you today?"
        if language == "en"
        else "नमस्ते! मैं आपका स्वास्थ्य सहायक हूँ। मैं आपकी कैसे मदद कर सकता हूँ?"
    )

    return ChatResponse(
        session_id=session_id,
        intent="greeting",
        entities={},
        reply=greeting
    )

# ----------------------------
# Main chatbot endpoint
# ----------------------------
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())
    language = req.language.lower() if req.language else "en"

    # Initialize session if new
    if session_id not in session_memory:
        session_memory[session_id] = {"turns": 0, "greeted": True}
        greeting = (
            "Hello! I’m your healthcare assistant. How can I help you today?"
            if language == "en"
            else "नमस्ते! मैं आपका स्वास्थ्य सहायक हूँ। मैं आपकी कैसे मदद कर सकता हूँ?"
        )
        return ChatResponse(
            session_id=session_id,
            intent="greeting",
            entities={},
            reply=greeting
        )

    session = session_memory[session_id]

    # Limit number of turns per session
    if session["turns"] >= 5:
        del session_memory[session_id]
        end_msg = (
            "Our session has ended. Please start a new chat if you need further help."
            if language == "en"
            else "हमारा सत्र समाप्त हो गया है। कृपया आगे सहायता के लिए नया चैट शुरू करें।"
        )
        return ChatResponse(
            session_id=session_id,
            intent="session_end",
            entities={},
            reply=end_msg
        )

    session["turns"] += 1

    # ----------------------------
    # Prepare user message with language instruction
    # ----------------------------
    lang_instruction = "Hindi" if language == "hi" else "English"
    user_prompt = (
        f"Respond ONLY in JSON format in {lang_instruction}. "
        f"Use keys 'reply', 'intent', and 'entities'. "
        f"My message: {req.message}"
    )

    # ----------------------------
    # Call Groq API
    # ----------------------------
    groq_reply = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"}
    )

    # Parse model JSON response safely
    try:
        data = json.loads(groq_reply.choices[0].message.content)
    except Exception:
        data = {"intent": "unknown", "entities": {}, "reply": "I'm here to help."}

    return ChatResponse(
        session_id=session_id,
        intent=data.get("intent", "unknown"),
        entities=data.get("entities", {}),
        reply=data.get("reply", "I'm here to help.")
    )
