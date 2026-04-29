from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional
import os
import json
import uuid
from groq import Groq
from dotenv import load_dotenv
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer
from pahadi_converter import convert_to_pahadi
from safety_layer import check_input_safety, check_output_safety  # ← NEW
from ner_extractor import extract_medical_terms  
from fastapi import FastAPI, UploadFile, File

load_dotenv()
GROQ_API_KEY     = os.getenv("GROQ_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX   = os.getenv("PINECONE_INDEX_NAME")

if not GROQ_API_KEY:
    raise ValueError("❌ GROQ_API_KEY not found")
if not PINECONE_API_KEY:
    raise ValueError("❌ PINECONE_API_KEY not found")

client   = Groq(api_key=GROQ_API_KEY)
pc       = Pinecone(api_key=PINECONE_API_KEY)
index    = pc.Index(PINECONE_INDEX)
embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    language: Optional[str] = "en"

class ChatResponse(BaseModel):
    session_id: str
    intent: str
    entities: Optional[Dict[str, Any]] = None
    reply: str

session_memory = {}

# ----------------------------
# RAG retrieval — BOTH namespaces
# ----------------------------
def retrieve_context(query: str, top_k: int = 3) -> str:
    try:
        query_vector = embedder.encode(query).tolist()

        # Query Gale Encyclopedia (default namespace, untouched)
        results_gale = index.query(
            vector=query_vector,
            top_k=top_k,
            include_metadata=True,
            namespace=""                  # existing Gale data
        )

        # Query HealthCareMagic (new namespace)
        results_hcm = index.query(
            vector=query_vector,
            top_k=top_k,
            include_metadata=True,
            namespace="healthcaremagic"   # new dataset
        )

        seen   = set()
        chunks = []

        # Combine + sort by score, best first
        all_matches = results_gale.matches + results_hcm.matches
        all_matches.sort(key=lambda x: x.score, reverse=True)

        for match in all_matches:
            if match.score > 0.3:
                text = match.metadata.get("text", "").strip()
                if text and text not in seen:
                    seen.add(text)
                    chunks.append(text)

        return "\n\n".join(chunks) if chunks else ""

    except Exception as e:
        print(f"❌ Pinecone error: {e}")
        return ""

# ----------------------------
# Simple case detector
# ----------------------------
SIMPLE_CASES = [
    "bee sting", "bee bite", "insect bite", "mosquito bite",
    "ant bite", "wasp sting", "minor burn", "small cut",
    "scratch", "splinter", "papercut", "runny nose",
    "mild cold", "hiccups", "sneezing", "mild headache only",
]

def is_simple_case(message: str) -> bool:
    lower = message.lower()
    return any(case in lower for case in SIMPLE_CASES)

# ----------------------------
# System Prompt
# ----------------------------
SYSTEM_PROMPT = """
You are a knowledgeable healthcare assistant for people in rural Uttarakhand, India.
You have access to the Gale Encyclopedia of Medicine and real doctor-patient 
conversations from HealthCareMagic as your medical reference.

LANGUAGE RULE — CRITICAL:
- If the language instruction says "Reply in simple Hindi only" — you MUST reply in Hindi/Pahadi only
- NEVER reply in English if a non-English language is specified
- This rule overrides everything else

GREETING RULES — VERY IMPORTANT:
- NEVER start any reply with "Hello", "Hi", "Namaste", "Ram Ram" or any greeting
- NEVER say "I'm your healthcare assistant" or introduce yourself again
- The user has already been greeted — never repeat it
- Go DIRECTLY to the medical response every time

SINGLE SYMPTOM RULE:
- If user mentions only 1 vague symptom (like just "fever" or just "headache")
  ask 2-3 follow-up questions BEFORE giving diagnosis
  Example follow-up: "How long have you had this fever? Is it mild or high?
  Do you also have chills, body ache, or cough?"
- BUT if the situation is clearly simple and self-contained (bee sting, insect
  bite, minor cut, minor burn) — give home remedy immediately, no follow-up needed

HOME REMEDY RULE:
- ALWAYS suggest simple home remedies where applicable
- Examples: rest, hydration, warm water gargle, ginger tea, turmeric milk,
  cold compress, steam inhalation, honey, saltwater gargle etc.
- Home remedies come BEFORE advising doctor visit
- For simple cases like bee sting: remove stinger, apply ice, take antihistamine

YOUR RESPONSE STRUCTURE — always follow this order:
1. FIRST — Name the most likely disease(s) based on symptoms
           OR ask follow-up questions if only 1 vague symptom given
2. SECOND — Briefly explain why these symptoms match
3. THIRD — Home remedies to try right now
4. FOURTH — When to see a doctor

STRICT RULES:
- ALWAYS name possible disease(s) first — never skip
- Never open with pleasantries or greetings
- Never say only "consult a doctor" without giving disease name + home remedy first
- Make it clear prediction is a possibility, not confirmed diagnosis
- Use simple language a village person can understand
- Max 5 sentences
- No complex medical jargon

EMERGENCY RULE:
If symptoms suggest life-threatening condition — chest pain, seizures,
difficulty breathing, high fever + stiff neck + confusion — name the
condition first then say go to hospital IMMEDIATELY. Still give emergency
home steps if applicable (like CPR position, keeping airway clear).

Always return valid JSON:
{
  "reply": "your full response here",
  "intent": "symptom_check",
  "entities": {
    "possible_diseases": ["Disease1", "Disease2"],
    "symptoms": ["symptom1", "symptom2"],
    "home_remedies": ["remedy1", "remedy2"]
  }
}

INTENT values: greeting / symptom_check / advice / emergency / unclear
"""

LANG_INSTRUCTIONS = {
    "en": "Reply in simple clear English.",
    "hi": "Reply in simple conversational Hindi. Use easy words that a village person can understand.",
    "pahadi": """IMPORTANT — तुम्हें सिर्फ पहाड़ी/हिंदी में जवाब देना है। एक भी अंग्रेजी शब्द नहीं।
Use these Pahadi words:
- बिसरो = rest, पाणी = water, ताव = fever
- कासणु = cough, दुखाण = pain, ओकाण = vomiting
- थकाण = tiredness, ठीक है जालो = you will be fine
हर वाक्य हिंदी/पहाड़ी में होना चाहिए। अंग्रेजी में जवाब देना मना है।"""}

# ----------------------------
# Endpoints
# ----------------------------
@app.get("/")
def root():
    return {"message": "Backend is live with RAG pipeline + HealthCareMagic + Safety Layer"}

@app.get("/test-pinecone")
async def test_pinecone():
    try:
        test_query = "memory loss confusion alzheimer"
        query_vector = embedder.encode(test_query).tolist()

        # Test both namespaces
        results_gale = index.query(
            vector=query_vector,
            top_k=2,
            include_metadata=True,
            namespace=""
        )
        results_hcm = index.query(
            vector=query_vector,
            top_k=2,
            include_metadata=True,
            namespace="healthcaremagic"
        )

        return {
            "status": "✅ Pinecone connected",
            "index": PINECONE_INDEX,
            "gale_results": [
                {"score": round(m.score, 4), "text": m.metadata.get("text", "")[:120]}
                for m in results_gale.matches
            ],
            "healthcaremagic_results": [
                {"score": round(m.score, 4), "text": m.metadata.get("text", "")[:120]}
                for m in results_hcm.matches
            ]
        }
    except Exception as e:
        return {"status": "❌ Failed", "error": str(e)}

@app.get("/start", response_model=ChatResponse)
async def start_chat():
    session_id = str(uuid.uuid4())
    session_memory[session_id] = {"turns": 0, "greeted": False}
    return ChatResponse(
        session_id=session_id,
        intent="greeting",
        entities={},
        reply="Hello! I am your healthcare assistant. How can I help you today?"
    )
@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), language: str = "en"):
    try:
        audio_bytes = await file.read()

        # Always use "hi" for both hindi and pahadi
        whisper_lang = "hi" if language in ["hi", "pahadi"] else "en"
        
        print(f"🎤 Transcribing — language={language}, whisper_lang={whisper_lang}")

        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(file.filename or "audio.webm", audio_bytes),
            language=whisper_lang,
            response_format="text"
        )

        print(f"✅ Transcription result: {transcription}")
        return {"text": transcription}

    except Exception as e:
        print(f"❌ Whisper error: {e}")
        return {"text": "", "error": str(e)}
    
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())

    if session_id not in session_memory:
        session_memory[session_id] = {"turns": 0, "greeted": False}

    session = session_memory[session_id]

    if session.get("turns", 0) >= 50:
        del session_memory[session_id]
        return ChatResponse(
            session_id=session_id,
            intent="session_end",
            entities={},
            reply="Session ended. Please start a new chat."
        )

    session["turns"] = session.get("turns", 0) + 1
    lang = req.language if req.language in LANG_INSTRUCTIONS else "en"
    lang_instruction = LANG_INSTRUCTIONS[lang]

    # ── Handle empty message ──
    if not req.message.strip():
        if not session.get("greeted", False):
            session["greeted"] = True
            greeting_map = {
                "en": "Please describe your symptoms and I'll help identify what might be wrong.",
                "hi": "अपने लक्षण बताएं, मैं बताऊंगा कि क्या हो सकता है।",
                "pahadi": "अपणि तकलीफ बताओ, म बताऊंगु क्या हो सकद।"
            }
            return ChatResponse(
                session_id=session_id,
                intent="greeting",
                entities={},
                reply=greeting_map.get(lang, greeting_map["en"])
            )
        return ChatResponse(
            session_id=session_id,
            intent="unclear",
            entities={},
            reply="Please describe your symptoms so I can help you."
        )

    session["greeted"] = True

    # ── INPUT SAFETY CHECK ──
    safety = check_input_safety(req.message, lang)
    if not safety["safe"]:
        return ChatResponse(
            session_id=session_id,
            intent=safety["intent"],
            entities={},
            reply=safety["reply"]
        )

    # ── Short message check ──
    word_count = len(req.message.strip().split())
    simple = is_simple_case(req.message)

    if word_count <= 2 and not simple:
        ask_more_map = {
            "en": "Could you tell me more? How long have you had this? Is it mild or severe? Any other symptoms like fever, pain, or weakness?",
            "hi": "थोड़ा और बताएं — यह कब से है? हल्का है या तेज? बुखार, दर्द या कमजोरी भी है?",
            "pahadi": "थोड़ु और बताओ — कब से छ? हल्कु छ या बौत तेज? ताव, दुखाण या थकाण भी छ?"
        }
        return ChatResponse(
            session_id=session_id,
            intent="unclear",
            entities={},
            reply=ask_more_map.get(lang, ask_more_map["en"])
        )

    # ── RAG ──
    ner_query = extract_medical_terms(req.message)  
    context = retrieve_context(ner_query)
    context_block = ""
    if context:
        context_block = f"""
MEDICAL REFERENCE (Gale Encyclopedia + HealthCareMagic real doctor conversations):
{context}

Use the above reference to support your answer.
"""

    user_prompt = f"""
{lang_instruction}

{context_block}

User message: {req.message}

REMEMBER:
- Do NOT greet or introduce yourself
- Name the most likely disease(s) FIRST
- Include home remedies
- End with doctor advice
- If only 1 vague symptom and not a simple case, ask follow-up questions first

Reply with JSON only. Keys: reply, intent, entities
entities must include: possible_diseases, symptoms, home_remedies
"""

    try:
        groq_reply = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=400
        )

        try:
            data = json.loads(groq_reply.choices[0].message.content)
        except Exception:
            data = {
                "intent": "unclear",
                "entities": {},
                "reply": "Please tell me more about your symptoms."
            }

        reply = data.get("reply", "Please describe your symptoms.")

        if lang == "pahadi":
            reply = convert_to_pahadi(reply)

        # ── OUTPUT SAFETY CHECK ──
        reply = check_output_safety(reply, lang)

        return ChatResponse(
            session_id=session_id,
            intent=data.get("intent", "symptom_check"),
            entities=data.get("entities", {}),
            reply=reply
        )

    except Exception as e:
        print(f"❌ Groq error: {e}")
        return ChatResponse(
            session_id=session_id,
            intent="error",
            entities={},
            reply="Something went wrong. Please try again."
        )

@app.get("/debug/sessions")
async def debug_sessions():
    return {
        "active_sessions": len(session_memory),
        "sessions": list(session_memory.keys())
    }