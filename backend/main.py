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
    allow_origins=["https://mchat-backend-isxf.onrender.com/chat"],  # use ["http://localhost:3000"] for safety in prod
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
# Session memory (temporary store)
# ----------------------------
session_memory = {}


# ----------------------------
# System Prompt for Groq LLM
# ----------------------------
SYSTEM_PROMPT = """
You are a medical symptom triage assistant for a hospital system.

Your responsibilities:
- Collect user symptoms and medical context
- Ask medically relevant follow-up questions
- Provide POSSIBLE categories (e.g., viral, allergy, gastric, muscular) — NOT diagnosis
- Give home-care suggestions when safe
- Suggest tests or doctor specialty only if appropriate
- Provide "seek urgent care" advice if red-flag symptoms appear
- NEVER give a definitive diagnosis
- NEVER prescribe medicine or dosage
- If unsure, recommend doctor visit

INTENTS:
book_appointment, cancel_appointment, get_lab_result, billing_query,
symptom_triage, smalltalk, human_handoff, unknown

Output STRICT JSON only:
{
 "intent": "",
 "entities": {
   "symptoms": [],
   "duration": "",
   "severity": "",
   "age": "",
   "other_factors": {}
 },
 "triage_assessment": "",
 "risk_level": "low | mild | moderate | high | emergency",
 "advice": "",
 "followup_questions": [],
 "reply": ""
}

Rules:
- If user explicitly requests diagnosis → reply that you do triage only and suggest doctor consultation.
- If emergency symptoms (chest pain, difficulty breathing, stroke signs, severe bleeding) → urge immediate hospital visit.
- Ask one follow-up question at a time.
- If the user types 'end chat' or 'thank you', then end the chat by closing with a thank-you message.
"""


# ----------------------------
# API Endpoints
# ----------------------------

@app.get("/start", response_model=ChatResponse)
async def start_chat():
    """Start a new chat session."""
    session_id = str(uuid.uuid4())
    session_memory[session_id] = {"turns": 0, "greeted": True}
    return ChatResponse(
        session_id=session_id,
        intent="greeting",
        entities={},
        reply="Hello! I’m your healthcare assistant. How can I help you today?"
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Main chatbot interaction endpoint."""
    session_id = req.session_id or str(uuid.uuid4())

    # Create new session if needed
    if session_id not in session_memory:
        session_memory[session_id] = {"turns": 0, "greeted": True}
        return ChatResponse(
            session_id=session_id,
            intent="greeting",
            entities={},
            reply="Hello! I’m your healthcare assistant. How can I help you today?"
        )

    session = session_memory[session_id]

    # End chat after 5 turns
    if session["turns"] >= 5:
        del session_memory[session_id]
        return ChatResponse(
            session_id=session_id,
            intent="session_end",
            entities={},
            reply="Our session has ended. Please start a new chat if you need further help."
        )

    session["turns"] += 1

    # Call Groq API for model response
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
