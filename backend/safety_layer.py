# safety_layer.py
import re

# ----------------------------
# INPUT SAFETY — block before LLM sees it
# ----------------------------

BLOCKED_INPUTS = [
    "how to overdose", "overdose on", "kill myself", "commit suicide",
    "end my life", "how much to take to die", "lethal dose",
    "how to poison", "want to die", "suicide method",
]

EMERGENCY_SYMPTOMS = [
    "chest pain", "heart attack", "can't breathe", "cannot breathe",
    "difficulty breathing", "seizure", "unconscious", "not breathing",
    "stroke", "severe bleeding", "coughing blood", "vomiting blood",
    "stiff neck", "neck stiff",
    "high fever stiff", "fever stiff neck",
    "paralysis", "face drooping",
    "arm weakness", "sudden confusion", "slurred speech",
]

EMERGENCY_RESPONSES = {
    "en": "⚠️ EMERGENCY: Your symptoms may indicate a life-threatening condition. Please call 112 immediately or go to the nearest hospital. Do not wait.",
    "hi": "⚠️ आपातकाल: आपके लक्षण गंभीर हो सकते हैं। तुरंत 112 पर कॉल करें या नजदीकी अस्पताल जाएं। देरी मत करें।",
    "pahadi": "⚠️ जरूरी: तुमारा हाल बौत गंभीर लगद। अभी 112 मा फोन करो या नजदीकी अस्पताल जाओ。",
    "garhwali": "⚠️ जरूरी: तुमरू हाल बौत गंभीर लगदू छ। अभी 112 मा फोन करा या नजदीकी अस्पताल जावा。"
}

BLOCKED_RESPONSE = {
    "en": "I'm sorry, I can't help with that. If you are feeling overwhelmed, please call iCall: 9152987821. Help is available.",
    "hi": "मैं इसमें मदद नहीं कर सकता। अगर आप मुश्किल में हैं, कृपया iCall पर कॉल करें: 9152987821।",
    "pahadi": "म इसमा मदद नि कर सकदु। iCall मा फोन करो: 9152987821。",
    "garhwali": "म इसमा मदद नि कर सकदु। iCall मा फोन करा: 9152987821。"
}


def check_input_safety(message: str, lang: str = "en") -> dict:
    """
    Returns:
        { "safe": True }  — if message is fine, proceed normally
        { "safe": False, "reply": "...", "intent": "blocked" }  — if blocked
        { "safe": False, "reply": "...", "intent": "emergency" }  — if emergency
    """
    lower = message.lower()

    # Check blocked inputs first
    if any(phrase in lower for phrase in BLOCKED_INPUTS):
        return {
            "safe": False,
            "reply": BLOCKED_RESPONSE.get(lang, BLOCKED_RESPONSE["en"]),
            "intent": "blocked"
        }

    # Check emergency symptoms
    if any(symptom in lower for symptom in EMERGENCY_SYMPTOMS):
        return {
            "safe": False,
            "reply": EMERGENCY_RESPONSES.get(lang, EMERGENCY_RESPONSES["en"]),
            "intent": "emergency"
        }

    return {"safe": True}


# ----------------------------
# OUTPUT SAFETY — fix LLM reply before sending to user
# ----------------------------

# Phrases where LLM sounds too confident — we soften them
OVERCONFIDENT_PHRASES = [
    (r"\byou have\b", "you may have"),
    (r"\bthis is\b", "this could be"),
    (r"\bdiagnosed with\b", "possibly related to"),
    (r"\bdefinitely\b", "possibly"),
    (r"\bcertainly\b", "likely"),
    (r"\bwithout doubt\b", "possibly"),
]

DISCLAIMER = {
    "en": "\n\n⚕️ Note: This is not a confirmed diagnosis. Please consult a doctor for proper evaluation.",
    "hi": "\n\n⚕️ नोट: यह पक्की जांच नहीं है। सही इलाज के लिए डॉक्टर से मिलें।",
    "pahadi": "\n\n⚕️ ध्यान रखो: यह पक्कु नि छ। डॉक्टर कन जरूर जाओ।"
}


def check_output_safety(reply: str, lang: str = "en") -> str:
    # Soften overconfident phrases
    for pattern, replacement in OVERCONFIDENT_PHRASES:
        reply = re.sub(pattern, replacement, reply, flags=re.IGNORECASE)

    return reply