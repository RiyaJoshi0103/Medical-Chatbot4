# ner_extractor.py
import spacy

# Load once at startup
nlp = spacy.load("en_core_sci_sm")

def extract_medical_terms(text: str) -> str:
    """
    Extracts medical entities from user message.
    Returns a cleaned query string for better Pinecone retrieval.
    Falls back to original text if nothing extracted.
    """
    try:
        doc = nlp(text)
        entities = [ent.text for ent in doc.ents]

        if entities:
            # Join extracted terms as search query
            enriched = " ".join(entities)
            print(f"🔍 NER extracted: {entities}")
            return enriched
        else:
            # No medical terms found, use original
            print("🔍 NER: no entities found, using original message")
            return text

    except Exception as e:
        print(f"❌ NER error: {e}")
        return text  # always fall back safely