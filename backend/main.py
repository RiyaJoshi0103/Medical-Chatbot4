from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional
import os
import json
import uuid
from groq import Groq
from dotenv import load_dotenv
from pinecone import Pinecone
from fastembed import TextEmbedding
from pahadi_converter import convert_to_pahadi
from safety_layer import check_input_safety, check_output_safety
from ner_extractor import extract_medical_terms  
import google.generativeai as genai

load_dotenv()
GROQ_API_KEY     = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY   = os.getenv("GEMINI_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX   = os.getenv("PINECONE_INDEX_NAME")

if not GROQ_API_KEY:
    raise ValueError("[ERROR] GROQ_API_KEY not found")
if not PINECONE_API_KEY:
    raise ValueError("[ERROR] PINECONE_API_KEY not found")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("[WARNING] GEMINI_API_KEY not found, transcription will fall back to Groq Whisper")

client   = Groq(api_key=GROQ_API_KEY)
pc       = Pinecone(api_key=PINECONE_API_KEY)
index    = pc.Index(PINECONE_INDEX)
import re
class FastEmbedWrapper:
    def __init__(self, model_name="sentence-transformers/all-MiniLM-L6-v2"):
        self.model_name = model_name
        self._model = None

    @property
    def model(self):
        if self._model is None:
            self._model = TextEmbedding(model_name=self.model_name)
        return self._model
    
    def encode(self, text_or_list):
        if isinstance(text_or_list, str):
            return list(self.model.embed([text_or_list]))[0]
        else:
            import numpy as np
            return np.array(list(self.model.embed(text_or_list)))

embedder = FastEmbedWrapper()

# Load Drug-Drug Interactions (DDI) dataset
DDI_FILE_PATH = os.path.join(os.path.dirname(__file__), "data", "ddi_interactions.json")
ddi_data = {}
ddi_drug_list = []
if os.path.exists(DDI_FILE_PATH):
    try:
        with open(DDI_FILE_PATH, "r", encoding="utf-8") as f:
            ddi_data = json.load(f)
            ddi_drug_list = list(ddi_data.keys())
        print(f"[OK] Loaded DDI dataset with {len(ddi_drug_list)} unique drugs")
    except Exception as e:
        print(f"[ERROR] Error loading DDI dataset: {e}")
else:
    print(f"[WARNING] DDI dataset not found at {DDI_FILE_PATH}")

DRUG_TRANSLITERATIONS = {
    "paracetamol": ["पैरासिटामोल", "पैरसिटामोल", "पैरासिटामॉल", "पैरसिटामॉल", "paracetamol"],
    "ibuprofen": ["आइबूप्रोफेन", "आइबुप्रोफेन", "इबुप्रोफेन", "इबूप्रोफेन", "इबुप्रोफ़ेन", "आइबुप्रोफ़ेन", "ibuprofen"],
    "aspirin": ["एस्पिरिन", "ऐस्पिरिन", "aspirin"],
    "cetirizine": ["सिट्रीजीन", "सेट्रीजीन", "सिट्रिजिन", "cetirizine"],
    "amoxicillin": ["अमोक्सिसिलिन", "एमोक्सिसिलिन", "amoxicillin"],
    "ors": ["ओआरएस", "ओ.आर.एस.", "ors"],
    "diclofenac": ["डाइक्लोफेनाक", "डिक्लोफेनेक", "diclofenac"],
    "ranitidine": ["रैनिटिडीन", "ranitidine"],
    "pantoprazole": ["पेंटाप्रोजोल", "पेन्टोप्राजोल", "pantoprazole"]
}

def detect_drugs(text: str, drug_list: list) -> list:
    """
    Scans the text for mentions of drugs in the drug list using word boundaries.
    Supports English names and common Devanagari transliterations.
    """
    text_lower = text.lower()
    detected = []
    for drug in drug_list:
        matched = False
        pattern = r'\b' + re.escape(drug) + r'\b'
        if re.search(pattern, text_lower):
            matched = True
        else:
            translit_list = DRUG_TRANSLITERATIONS.get(drug, [])
            for translit in translit_list:
                if translit in text_lower:
                    matched = True
                    break
        if matched:
            detected.append(drug)
    return detected


# Load Medicines Database (for contraindications check)
MEDICINES_FILE_PATH = os.path.join(os.path.dirname(__file__), "data", "medicines_clean.csv")
USER_PROFILES_FILE = os.path.join(os.path.dirname(__file__), "data", "user_profiles.json")

def load_user_profile(email: str) -> dict:
    if not email:
        return {}
    if os.path.exists(USER_PROFILES_FILE):
        try:
            with open(USER_PROFILES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get(email.lower().strip(), {})
        except Exception as e:
            print(f"[ERROR] Error loading user profiles: {e}")
    return {}

def save_user_profile(email: str, profile: dict):
    if not email:
        return
    profiles = {}
    if os.path.exists(USER_PROFILES_FILE):
        try:
            with open(USER_PROFILES_FILE, "r", encoding="utf-8") as f:
                profiles = json.load(f)
        except Exception as e:
            print(f"[ERROR] Error loading user profiles for saving: {e}")
    
    profiles[email.lower().strip()] = profile
    try:
        os.makedirs(os.path.dirname(USER_PROFILES_FILE), exist_ok=True)
        with open(USER_PROFILES_FILE, "w", encoding="utf-8") as f:
            json.dump(profiles, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[ERROR] Error saving user profiles: {e}")
medicine_data = {}
if os.path.exists(MEDICINES_FILE_PATH):
    try:
        import csv
        with open(MEDICINES_FILE_PATH, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row["medicine_name"].strip().lower()
                contras = [c.strip().lower() for c in row["contraindications"].split(",") if c.strip()]
                medicine_data[name] = {
                    "indication": row["indication"].strip().lower(),
                    "contraindications": contras,
                    "contraindications_raw": row["contraindications"].strip()
                }
        print(f"[OK] Loaded {len(medicine_data)} medicines for contraindication checks")
    except Exception as e:
        print(f"[ERROR] Error loading medicines dataset: {e}")
else:
    print(f"[WARNING] Medicines dataset not found at {MEDICINES_FILE_PATH}")

CHRONIC_SYNONYMS = {
    "kidney disease": ["kidney", "renal", "anuria", "nephro"],
    "renal failure": ["kidney", "renal", "anuria", "nephro"],
    "diabetes": ["diabetes", "diabetic", "glycemia"],
    "asthma": ["asthma", "bronchospasm", "copd", "respiratory", "bronchitis"],
    "liver disease": ["liver", "hepatic", "cirrhosis"],
    "heart disease": ["heart", "cardiac", "angina", "coronary", "myocardial", "hypertension", "blood pressure"],
    "anemia": ["anemia", "bleeding", "hemophilia", "coagulation"],
    "hypertension": ["hypertension", "high blood pressure"]
}

def check_contraindications(chronic_conditions: list, suggested_medicines: list) -> list:
    """
    Checks if any suggested medicine is contraindicated for any of the patient's chronic conditions.
    """
    alerts = []
    for med in suggested_medicines:
        med_lower = med.lower().strip()
        db_med = None
        # Try to find exact match first to prevent false matches with combination drugs (trigger reload)
        if med_lower in medicine_data:
            db_med = med_lower
        else:
            for key in medicine_data:
                if key == med_lower or key.startswith(med_lower) or med_lower in key:
                    db_med = key
                    break
        
        if not db_med:
            continue
            
        contra_list = medicine_data[db_med]["contraindications"]
        for condition in chronic_conditions:
            cond_lower = condition.lower().strip()
            
            # Clinical Override: Skip paracetamol/acetaminophen warning for kidney disease / renal failure
            is_paracetamol_or_acetaminophen = "paracetamol" in med_lower or "acetaminophen" in med_lower
            if is_paracetamol_or_acetaminophen and cond_lower in ["kidney disease", "renal failure"]:
                continue
                
            synonyms = CHRONIC_SYNONYMS.get(cond_lower, [cond_lower])
            for syn in synonyms:
                for contra in contra_list:
                    if syn in contra:
                        alerts.append({
                            "medicine": med,
                            "chronic_condition": condition,
                            "contraindication": contra
                        })
                        break
                else:
                    continue
                break
    return alerts

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
    for_family: Optional[bool] = False
    user_email: Optional[str] = None

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
        print(f"[ERROR] Pinecone error: {e}")
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
LANG_INSTRUCTIONS = {
    "en": "Reply in simple clear English.",
    "hi": "Reply in simple conversational Hindi. Use easy words that a village person can understand.",
    "pahadi": """IMPORTANT — तुम्हें सिर्फ पहाड़ी/हिंदी में जवाब देना है। एक भी अंग्रेजी शब्द नहीं।
Use these Pahadi words:
- बिसरो = rest, पाणी = water, ताव = fever
- कासणु = cough, दुखाण = pain, ओकाण = vomiting
- थकाण = tiredness, ठीक है जालो = you will be fine
हर वाक्य हिंदी/पहाड़ी में होना चाहिए। अंग्रेजी में जवाब देना मना है।""",
    "garhwali": """IMPORTANT — तुम्हें सिर्फ गढ़वाली/हिंदी में जवाब देना है। एक भी अंग्रेजी शब्द नहीं।
गढ़वाली के कुछ शब्दों का उपयोग करें:
- ताव = बुखार, पाणी = पानी, बिसरो = आराम
- खुजली/कासणु = खाँसी, पीड़ा/दुखणू = दर्द, उल्टी/ओकाण = उल्टी
- ठीक ह्वै जालो = तुम ठीक हो जाओगे
गढ़वाली पहाड़ी बोली में बातचीत करें। ग्रामीण व्यक्ति के समझने योग्य सरल शब्दों का उपयोग करें। अंग्रेजी का प्रयोग न करें।"""
}
SYSTEM_PROMPT = """
You are a knowledgeable healthcare assistant for people in rural Uttarakhand, India.
You have access to the Gale Encyclopedia of Medicine and real doctor-patient 
conversations from HealthCareMagic as your medical reference.

LANGUAGE RULE — CRITICAL:
- If the requested language is non-English (hi, pahadi, garhwali), you MUST reply ONLY in Hindi/Pahadi/Garhwali using Devanagari script (no English text, no romanized Hindi/Hinglish).
- NEVER reply in English when a non-English language is specified, even if the user asks their question in English. The selected language overrides the user's message language.
- This rule overrides everything else.


GREETING RULES — VERY IMPORTANT:
- NEVER start any reply with "Hello", "Hi", "Namaste", "Ram Ram" or any greeting
- NEVER say "I'm your healthcare assistant" or introduce yourself again
- The user has already been greeted — never repeat it
- Go DIRECTLY to the medical response every time

FOLLOW-UP QUESTION RULE — STRICT LIMIT OF ONE QUESTION PER SESSION:
- You are allowed to ask at most ONE follow-up question in the entire conversation.
- Check the chat history: if a follow-up question has ALREADY been asked by the assistant in any previous turn, you are strictly FORBIDDEN from asking another question. You MUST NOT ask any follow-up questions under any circumstances.
- If a question was already asked, you must immediately diagnose/name possible conditions (e.g. general fatigue, viral onset, tension headache, or malaise) based on the limited info, and suggest standard home remedies and basic safe OTC options.
- NEVER ask for details that the user has already provided in their messages (such as duration or severity).
- Keep the single follow-up question (if allowed) extremely short and direct.

HOME REMEDY & BASIC MEDICINE RULE:
- Suggest simple home remedies (e.g. rest, hydration, warm water gargle, steam inhalation, ginger tea) AND basic over-the-counter (OTC) medicines where appropriate.
- ONLY suggest safe, extremely basic, common OTC medicines (e.g., Paracetamol for fever/pain, ORS for dehydration/diarrhea, Cetirizine for mild allergy/runny nose).
- NEVER suggest any high-level, strong, or prescription-only medications (e.g., antibiotics like Amoxicillin, strong painkillers, steroids). Keep it strictly to basic and safe low-level options.
- Home remedies and basic OTC medicines come BEFORE advising doctor visit.
- For simple cases like bee sting: remove stinger, apply ice, take basic antihistamine.

YOUR RESPONSE STRUCTURE — always follow this order:
WHEN YOU HAVE ENOUGH INFO:
1. FIRST — Name the most likely disease(s) based on symptoms
2. SECOND — Briefly explain why these symptoms match
3. THIRD — Home remedies and basic OTC medicines to try right now
4. FOURTH — When to see a doctor

WHEN YOU NEED MORE INFO:
1. Ask exactly ONE specific, targeted follow-up question. Never ask more than one.
2. Do NOT give a disease name, remedy, or medicine yet
3. Wait for the user's reply before diagnosing

STRICT RULES:
- NEVER diagnose or suggest medicine on vague input on the very first turn — ask a follow-up question first. However, if the user has already answered the follow-up or clarified that they have no other symptoms/details, do not ask again. Proceed to suggest general remedies and general possibility (e.g. malaise/viral prodrome/fatigue) on the second turn.
- Never open with pleasantries or greetings
- Never say only "consult a doctor" without giving disease name + home remedy/basic medicine first
- Make it clear prediction is a possibility, not confirmed diagnosis
- Use simple language a village person can understand
- Max 3 sentences per response (keep replies extremely short, simple, and direct)
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
    "home_remedies": ["remedy1", "remedy2"],
    "detected_chronic_conditions": ["kidney disease"]
  }
}

When asking follow-up questions, use:
{
  "reply": "your single follow-up question here",
  "intent": "unclear",
  "entities": {
    "possible_diseases": [],
    "symptoms": ["symptom mentioned so far"],
    "home_remedies": [],
    "detected_chronic_conditions": []
  }
}

CHRONIC DISEASE RULE:
- Identify if the user mentions any past chronic diseases (e.g. kidney disease, diabetes, heart failure, asthma, hypertension, liver disease) and output them in the 'detected_chronic_conditions' list in entities.

INTENT values: greeting / symptom_check / advice / emergency / unclear
"""
# ----------------------------
# Endpoints
# ----------------------------
@app.get("/")
def root():
    return {"message": "Backend is live with RAG pipeline + HealthCareMagic + Safety Layer"}

@app.get("/profile")
def get_profile(email: str):
    profile = load_user_profile(email)
    return {
        "email": email,
        "chronic_conditions": profile.get("chronic_conditions", [])
    }

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
    session_memory[session_id] = {"turns": 0, "greeted": False, "chronic_conditions": []}
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

        if GEMINI_API_KEY:
            try:
                print(f"[INFO] Transcribing via Gemini — language={language}")
                mime = file.content_type or "audio/webm"
                if not mime.startswith("audio/"):
                    mime = "audio/webm"

                model = genai.GenerativeModel("gemini-2.5-flash")
                prompt = (
                    f"Please transcribe this audio. The speaker is speaking in {language} (which could be English, Hindi, Pahadi, or Garhwali). "
                    "Output ONLY the exact transcription in the native script (Devanagari script for Hindi, Pahadi, and Garhwali; Roman alphabet for English). "
                    "Do NOT translate, do NOT explain, and do NOT add any additional text or commentary."
                )

                response = model.generate_content([
                    {
                        "mime_type": mime,
                        "data": audio_bytes
                    },
                    prompt
                ])

                transcription = response.text.strip()
                print(f"[OK] Gemini Transcription: {transcription}")
                return {"text": transcription}
            except Exception as gemini_err:
                print(f"[WARNING] Gemini transcription failed, falling back to Whisper: {gemini_err}")

        # Fallback to Whisper
        whisper_lang = "hi" if language in ["hi", "pahadi", "garhwali"] else "en"
        print(f"[INFO] Transcribing via Whisper — language={language}, whisper_lang={whisper_lang}")

        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(file.filename or "audio.webm", audio_bytes),
            language=whisper_lang,
            response_format="text"
        )

        print(f"[OK] Whisper Transcription: {transcription}")
        return {"text": transcription}

    except Exception as e:
        print(f"[ERROR] Transcription error: {e}")
        return {"text": "", "error": str(e)}
    
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())

    if session_id not in session_memory:
        session_memory[session_id] = {"turns": 0, "greeted": False, "chronic_conditions": []}

    session = session_memory[session_id]

    # Load persistent user profile chronic conditions if logged in
    email = req.user_email.strip() if req.user_email else None
    if email:
        profile = load_user_profile(email)
        profile_conditions = profile.get("chronic_conditions", [])
        if "chronic_conditions" not in session:
            session["chronic_conditions"] = []
        for cond in profile_conditions:
            cond_clean = cond.strip().lower()
            if cond_clean and cond_clean not in session["chronic_conditions"]:
                session["chronic_conditions"].append(cond_clean)

    if session.get("turns", 0) >= 50:
        del session_memory[session_id]
        return ChatResponse(
            session_id=session_id,
            intent="session_end",
            entities={"chronic_conditions": session.get("chronic_conditions", [])},
            reply="Session ended. Please start a new chat."
        )

    session["turns"] = session.get("turns", 0) + 1
    lang = req.language if req.language in LANG_INSTRUCTIONS else "en"
    lang_instruction = LANG_INSTRUCTIONS[lang]

    # ── Rule-based Chronic Disease Detection Fallback ──
    KNOWN_CHRONIC_DISEASES = ["kidney disease", "renal failure", "diabetes", "asthma", "liver disease", "heart disease", "anemia", "hypertension"]
    msg_lower = req.message.lower()
    for disease in KNOWN_CHRONIC_DISEASES:
        if disease in msg_lower:
            if "chronic_conditions" not in session:
                session["chronic_conditions"] = []
            if disease not in session["chronic_conditions"]:
                session["chronic_conditions"].append(disease)
    # Synonym maps for basic detection
    if "high blood pressure" in msg_lower:
        if "chronic_conditions" not in session:
            session["chronic_conditions"] = []
        if "hypertension" not in session["chronic_conditions"]:
            session["chronic_conditions"].append("hypertension")

    # ── Handle empty message ──
    if not req.message.strip():
        if not session.get("greeted", False):
            session["greeted"] = True
            greeting_map = {
                "en": "Please describe your symptoms and I'll help identify what might be wrong.",
                "hi": "अपने लक्षण बताएं, मैं बताऊंगा कि क्या हो सकता है।",
                "pahadi": "अपणि तकलीफ बताओ, म बताऊंगु क्या हो सकद।",
                "garhwali": "अपणि तकलीफ बताओ, म बताऊंगु क्या हो सकद।"
            }
            return ChatResponse(
                session_id=session_id,
                intent="greeting",
                entities={"chronic_conditions": session.get("chronic_conditions", [])},
                reply=greeting_map.get(lang, greeting_map["en"])
            )
        return ChatResponse(
            session_id=session_id,
            intent="unclear",
            entities={"chronic_conditions": session.get("chronic_conditions", [])},
            reply="Please describe your symptoms so I can help you."
        )

    session["greeted"] = True

    # ── INPUT SAFETY CHECK ──
    safety = check_input_safety(req.message, lang)
    if not safety["safe"]:
        return ChatResponse(
            session_id=session_id,
            intent=safety["intent"],
            entities={"chronic_conditions": session.get("chronic_conditions", [])},
            reply=safety["reply"]
        )

    # ── Short message check ──
    word_count = len(req.message.strip().split())
    simple = is_simple_case(req.message)
    has_history = len(session.get("history", [])) > 0

    if word_count <= 2 and not simple and not has_history:
        ask_more_map = {
            "en": "Could you tell me more? How long have you had this? Is it mild or severe? Any other symptoms like fever, pain, or weakness?",
            "hi": "थोड़ा और बताएं — यह कब से है? हल्का है या तेज? बुखार, दर्द या कमजोरी भी है?",
            "pahadi": "थोड़ु और बताओ — कब से छ? हल्कु छ या बौत तेज? ताव, दुखाण या थकाण भी छ?",
            "garhwali": "थोड़ु और बताओ — यो कब बिटी छ? हल्कु छ या बौत तेज? ताव, दुखाण या थकाण भी छ?"
        }
        return ChatResponse(
            session_id=session_id,
            intent="unclear",
            entities={"chronic_conditions": session.get("chronic_conditions", [])},
            reply=ask_more_map.get(lang, ask_more_map["en"])
        )

    # ── Drug-Drug Interaction (DDI) Detection ──
    detected_drugs = detect_drugs(req.message, ddi_drug_list)
    ddi_alerts = []
    ddi_instruction = ""

    if len(detected_drugs) >= 2:
        for i in range(len(detected_drugs)):
            for j in range(i + 1, len(detected_drugs)):
                d1 = detected_drugs[i]
                d2 = detected_drugs[j]
                if d2 in ddi_data.get(d1, {}):
                    severity = ddi_data[d1][d2]
                    ddi_alerts.append({
                        "drug_a": d1,
                        "drug_b": d2,
                        "severity": severity
                    })
        
        if ddi_alerts:
            ddi_warnings = [
                f"- WARNING: '{alert['drug_a']}' and '{alert['drug_b']}' have a recorded {alert['severity']} severity interaction."
                for alert in ddi_alerts
            ]
            ddi_warnings_str = "\n".join(ddi_warnings)
            print(f"[WARNING] DDI Detected: {ddi_alerts}")
            ddi_instruction = f"""
⚠️ CRITICAL DRUG-DRUG INTERACTION WARNING:
{ddi_warnings_str}
You MUST explicitly warn the user about this interaction in your response. Advise them on the safety of taking these medicines together. Keep it clear and direct.
"""

    # ── Chronic Disease Contraindications RAG ──
    active_chronic = session.get("chronic_conditions", [])
    chronic_instruction = ""
    if req.for_family:
        chronic_instruction = """
NOTE: This consultation is for a family member, NOT the main user. Ignore the user's chronic conditions or personal history for this response. Suggest standard treatments.
"""
    elif active_chronic:
        relevant_rules = []
        for med_name, info in medicine_data.items():
            for condition in active_chronic:
                synonyms = CHRONIC_SYNONYMS.get(condition, [condition])
                for syn in synonyms:
                    for contra in info["contraindications"]:
                        if syn in contra:
                            relevant_rules.append(f"- '{med_name}' is CONTRAINDICATED for patients with '{condition}' (due to: {info['contraindications_raw']})")
                            break
                    else:
                        continue
                    break
        
        if relevant_rules:
            rules_str = "\n".join(relevant_rules[:15]) # cap to 15 rules for prompt efficiency
            print(f"[WARNING] Contraindications rules loaded: {len(relevant_rules)} rules")
            chronic_instruction = f"""
⚠️ PATIENT MEDICAL HISTORY:
- Active Chronic Conditions: {active_chronic}

MEDICINE CONTRAINDICATION RULES FOR THIS PATIENT:
{rules_str}

CRITICAL RULES:
1. You MUST check the patient's active chronic conditions before suggesting any medicine.
2. NEVER suggest or recommend any medicine listed under the contraindication rules. For example, if a patient has kidney disease, do NOT suggest ibuprofen or aspirin. Suggest paracetamol instead.
3. If the user asks about a medicine that is contraindicated, you MUST warn them that it is unsafe, explain why based on the rules, and suggest a safe alternative.
"""

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

{ddi_instruction}

{chronic_instruction}

{context_block}

User message: {req.message}

REMEMBER:
- Do NOT greet or introduce yourself
- Check the chat history: if any follow-up question has ALREADY been asked in any previous turn, you are strictly FORBIDDEN from asking another question. You MUST NOT ask any questions. Proceed directly to diagnosis and remedies based on the current text.
- NEVER ask for details that the user has already provided in their messages.
- Include home remedies and basic OTC medicines only after diagnosis/preliminary assessment.
- End with doctor advice only after diagnosis/preliminary assessment.
- Keep your replies extremely short, simple, direct, and under 3 sentences maximum.
- CRITICAL LANGUAGE RULE: You MUST output the "reply" value in language: {lang.upper()}.
  If language is HI, PAHADI, or GARHWALI, the reply MUST be written entirely in Devanagari script (Hindi/Pahadi/Garhwali) and contain absolutely NO English sentences or English explanations.

Reply with JSON only. Keys: reply, intent, entities
entities must include: possible_diseases, symptoms, home_remedies
"""
    try:
        # Build messages including history
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for msg in session.get("history", []):
            messages.append(msg)
        messages.append({"role": "user", "content": user_prompt})

        response_text = None
        try:
            groq_reply = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.4,
                max_tokens=400
            )
            response_text = groq_reply.choices[0].message.content
        except Exception as groq_err:
            print(f"[WARNING] Groq primary model rate limited or failed: {groq_err}. Trying fallback models...")
            
            # 1. Try smaller/faster Groq model
            try:
                print("[INFO] Trying Groq fallback model: llama-3.1-8b-instant")
                groq_reply_fb = client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.4,
                    max_tokens=400
                )
                response_text = groq_reply_fb.choices[0].message.content
                print("[OK] Groq fallback model succeeded!")
            except Exception as groq_fb_err:
                print(f"[WARNING] Groq fallback model also failed: {groq_fb_err}")
            
            # 2. Try Gemini fallback if Groq failed and GEMINI_API_KEY is available
            if not response_text and GEMINI_API_KEY:
                try:
                    print("[INFO] Trying Gemini fallback model: gemini-2.5-flash")
                    system_instruction = ""
                    gemini_messages = []
                    for m in messages:
                        if m["role"] == "system":
                            system_instruction += m["content"] + "\n"
                        else:
                            role = "user" if m["role"] == "user" else "model"
                            gemini_messages.append({
                                "role": role,
                                "parts": [m["content"]]
                            })
                    
                    gemini_model = genai.GenerativeModel(
                        model_name="gemini-2.5-flash",
                        system_instruction=system_instruction.strip() if system_instruction else None
                    )
                    
                    gemini_response = gemini_model.generate_content(
                        gemini_messages,
                        generation_config={"response_mime_type": "application/json"}
                    )
                    response_text = gemini_response.text
                    print("[OK] Gemini fallback succeeded!")
                except Exception as gemini_err:
                    print(f"[ERROR] Gemini fallback failed: {gemini_err}")
            
            if not response_text:
                raise groq_err

        try:
            data = json.loads(response_text)
        except Exception as parse_err:
            print(f"[ERROR] Failed to parse JSON response: {parse_err}. Response content: {response_text}")
            data = {
                "intent": "unclear",
                "entities": {},
                "reply": "Please tell me more about your symptoms."
            }

        reply = data.get("reply", "Please describe your symptoms.")

        # Extract detected chronic conditions from JSON response and update session
        entities_data = data.get("entities", {})
        if isinstance(entities_data, dict):
            detected_chronic = entities_data.get("detected_chronic_conditions", [])
            if isinstance(detected_chronic, list):
                for cond in detected_chronic:
                    cond_clean = cond.strip().lower()
                    if cond_clean:
                        if "chronic_conditions" not in session:
                            session["chronic_conditions"] = []
                        if cond_clean not in session["chronic_conditions"]:
                            session["chronic_conditions"].append(cond_clean)

        if lang == "pahadi":
            reply = convert_to_pahadi(reply)

        # ── OUTPUT SAFETY CHECK ──
        reply = check_output_safety(reply, lang)

        # Append turn to history
        if "history" not in session:
            session["history"] = []
        session["history"].append({"role": "user", "content": req.message})
        session["history"].append({"role": "assistant", "content": reply})
        if len(session["history"]) > 10:
            session["history"] = session["history"][-10:]

        entities = data.get("entities", {})
        if not isinstance(entities, dict):
            entities = {}
        if ddi_alerts:
            entities["ddi_alerts"] = ddi_alerts

        # Scan bot reply for medicines and check if they trigger any contraindications
        suggested_meds = detect_drugs(reply, list(medicine_data.keys()))
        entities["suggested_medicines"] = suggested_meds
        
        if req.for_family:
            contra_alerts = []
        else:
            contra_alerts = check_contraindications(session.get("chronic_conditions", []), suggested_meds)
            
        entities["chronic_conditions"] = session.get("chronic_conditions", [])
        if contra_alerts:
            entities["contraindication_alerts"] = contra_alerts

        # Save back to user profile if email is present
        if email:
            save_user_profile(email, {
                "chronic_conditions": session.get("chronic_conditions", [])
            })


        return ChatResponse(
            session_id=session_id,
            intent=data.get("intent", "symptom_check"),
            entities=entities,
            reply=reply
        )

    except Exception as e:
        print(f"[ERROR] Groq error: {e}")
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