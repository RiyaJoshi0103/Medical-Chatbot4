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

ALWAYS respond in valid JSON format with these exact keys:
- "reply": Your response message in the requested language
- "intent": The detected intent (e.g., "symptom_check", "greeting", "emergency")
- "entities": Any extracted entities like symptoms, duration, severity

Follow the language specified in the user's request exactly.
IMPORTANT: Never return a greeting message when the user is describing symptoms.
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
        "Hello! I'm your healthcare assistant. How can I help you today?"
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
# Main chatbot endpoint - COMPLETELY FIXED VERSION
# ----------------------------
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # Debug logging
    print(f"🔍 [DEBUG] Received request:")
    print(f"🔍 [DEBUG] Session ID: {req.session_id}")
    print(f"🔍 [DEBUG] Message: '{req.message}'")
    print(f"🔍 [DEBUG] Language: {req.language}")
    
    session_id = req.session_id or str(uuid.uuid4())
    language = req.language.lower() if req.language else "en"

    # Debug session info
    session_exists = session_id in session_memory
    print(f"🔍 [DEBUG] Session exists: {session_exists}")
    print(f"🔍 [DEBUG] All sessions: {list(session_memory.keys())}")

    # Initialize session if new - BUT DON'T RETURN GREETING
    if not session_exists:
        session_memory[session_id] = {"turns": 0, "greeted": True}
        print(f"🔍 [DEBUG] Created new session: {session_id}")

    session = session_memory[session_id]

    # Limit number of turns per session
    if session.get("turns", 0) >= 50:  # Increased limit
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

    session["turns"] = session.get("turns", 0) + 1
    print(f"🔍 [DEBUG] Turn count: {session['turns']}")

    # ----------------------------
    # Enhanced prompt to prevent greeting responses
    # ----------------------------
    lang_instruction = "Respond in Hindi" if language == "hi" else "Respond in English"
    
    user_prompt = f"""
    {lang_instruction}. Use JSON format with keys: "reply", "intent", "entities".
    
    User message: {req.message}
    
    IMPORTANT: 
    - If the user is describing symptoms (like fever, pain, etc.), provide medical advice and ask follow-up questions
    - DO NOT respond with greetings like "Hello" or "How can I help you?" 
    - Provide specific, helpful medical guidance based on the symptoms described
    
    Current user message: "{req.message}"
    """

    print(f"🔍 [DEBUG] Sending to LLM: {user_prompt[:200]}...")

    # ----------------------------
    # Call Groq API
    # ----------------------------
    try:
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

        # Parse model JSON response safely
        try:
            data = json.loads(groq_reply.choices[0].message.content)
            print(f"🔍 [DEBUG] LLM Response: {data}")
            
            # Check if the response contains greeting (which we don't want)
            reply_text = data.get("reply", "")
            if any(greeting in reply_text.lower() for greeting in ["hello", "hi", "नमस्ते", "how can i help"]):
                print("⚠️ [DEBUG] LLM returned greeting, generating fallback...")
                # Generate appropriate fallback based on user's message
                if "fever" in req.message.lower() or "बुखार" in req.message:
                    fallback_reply = (
                        "I understand you have a fever. Could you tell me how high your temperature is and how long you've had it?"
                        if language == "en"
                        else "मैं समझता हूं कि आपको बुखार है। क्या आप बता सकते हैं कि आपका तापमान कितना है और कब से है?"
                    )
                else:
                    fallback_reply = (
                        "I understand you're describing symptoms. Could you tell me more about how you're feeling?"
                        if language == "en"
                        else "मैं समझता हूं कि आप लक्षण बता रहे हैं। क्या आप मुझे और अधिक विस्तार से बता सकते हैं कि आप कैसा महसूस कर रहे हैं?"
                    )
                data["reply"] = fallback_reply
                
        except Exception as e:
            print(f"❌ [DEBUG] JSON parsing error: {e}")
            # Context-aware fallback response
            if "fever" in req.message.lower() or "बुखार" in req.message:
                fallback_reply = (
                    "I understand you have a fever. Could you tell me how high your temperature is and how long you've had it?"
                    if language == "en"
                    else "मैं समझता हूं कि आपको बुखार है। क्या आप बता सकते हैं कि आपका तापमान कितना है और कब से है?"
                )
            else:
                fallback_reply = (
                    "I understand you're describing symptoms. Could you tell me more about how you're feeling?"
                    if language == "en"
                    else "मैं समझता हूं कि आप लक्षण बता रहे हैं। क्या आप मुझे और अधिक विस्तार से बता सकते हैं कि आप कैसा महसूस कर रहे हैं?"
                )
            data = {
                "intent": "symptom_check", 
                "entities": {}, 
                "reply": fallback_reply
            }

        print(f"✅ [DEBUG] Final response: {data['reply'][:100]}...")
        return ChatResponse(
            session_id=session_id,
            intent=data.get("intent", "unknown"),
            entities=data.get("entities", {}),
            reply=data.get("reply", "I'm here to help." if language == "en" else "मैं यहां मदद के लिए हूं।")
        )

    except Exception as e:
        print(f"❌ [DEBUG] Groq API error: {e}")
        error_reply = (
            "I'm experiencing technical difficulties. Please try again."
            if language == "en"
            else "मुझे तकनीकी कठिनाइयों का सामना करना पड़ रहा है। कृपया बाद में पुनः प्रयास करें।"
        )
        return ChatResponse(
            session_id=session_id,
            intent="error",
            entities={},
            reply=error_reply
        )

# ----------------------------
# Debug endpoint to check sessions
# ----------------------------
@app.get("/debug/sessions")
async def debug_sessions():
    return {
        "active_sessions": len(session_memory),
        "sessions": list(session_memory.keys())
    }