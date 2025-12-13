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

# Enable CORS
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
# System Prompt for Groq LLM
# ----------------------------
SYSTEM_PROMPT = """
You are a medical symptom triage assistant for a hospital system.
You help users understand their symptoms, suggest possible causes,
and provide guidance on home care or whether they should see a doctor.

ALWAYS respond in valid JSON format with these exact keys:
- "reply": Your response message in English
- "intent": The detected intent (e.g., "symptom_check", "greeting", "emergency")
- "entities": Any extracted entities like symptoms, duration, severity

IMPORTANT:
- Provide actionable guidance based on the user's symptoms.
- If symptoms indicate a potentially serious disease (like dengue, malaria, heart issues), advise seeking medical attention immediately.
- Never provide false reassurance or a definitive diagnosis.
- Do not return generic greetings when the user describes symptoms.
"""

# ----------------------------
# Root / health check
# ----------------------------
@app.get("/")
def root():
    return {"message": "Backend is live"}

# ----------------------------
# Start new chat session
# ----------------------------
@app.get("/start", response_model=ChatResponse)
async def start_chat():
    session_id = str(uuid.uuid4())
    session_memory[session_id] = {"turns": 0}

    greeting = "Hello! I'm your healthcare assistant. How can I help you today?"

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

    # Initialize session if new
    if session_id not in session_memory:
        session_memory[session_id] = {"turns": 0}

    session = session_memory[session_id]

    # Limit turns per session
    if session.get("turns", 0) >= 50:
        del session_memory[session_id]
        end_msg = "Our session has ended. Please start a new chat if you need further help."
        return ChatResponse(session_id=session_id, intent="session_end", entities={}, reply=end_msg)

    session["turns"] = session.get("turns", 0) + 1

    # ----------------------------
    # Prepare user prompt for LLM
    # ----------------------------
    user_prompt = f"""
Respond in English. Use JSON format with keys: "reply", "intent", "entities".

User message: {req.message}

IMPORTANT:
- Provide symptom-based guidance.
- Suggest home care or when to see a doctor.
- If symptoms indicate serious illness, advise urgent medical attention.
- Avoid greetings like "Hello" or vague responses.
"""

    try:
        # Call Groq LLM
        groq_reply = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=1024
        )

        # Parse JSON response
        try:
            data = json.loads(groq_reply.choices[0].message.content)
        except Exception:
            # Fallback if parsing fails
            data = {
                "intent": "symptom_check",
                "entities": {},
                "reply": "Please provide more details about your symptoms."
            }

        return ChatResponse(
            session_id=session_id,
            intent=data.get("intent", "unknown"),
            entities=data.get("entities", {}),
            reply=data.get("reply", "I'm here to help.")
        )

    except Exception:
        return ChatResponse(
            session_id=session_id,
            intent="error",
            entities={},
            reply="I'm experiencing technical difficulties. Please try again."
        )

# ----------------------------
# Debug endpoint
# ----------------------------
@app.get("/debug/sessions")
async def debug_sessions():
    return {"active_sessions": len(session_memory), "sessions": list(session_memory.keys())}
