# ner_extractor.py
nlp = None
try:
    import spacy
    # Load once at startup
    nlp = spacy.load("en_core_sci_sm")
    print("[OK] NER successfully loaded 'en_core_sci_sm' model")
except Exception as e:
    print(f"[WARNING] NER initialization failed (spacy/model not available): {e}")

def extract_medical_terms(text: str) -> str:
    """
    Extracts medical entities from user message.
    Returns a cleaned query string for better Pinecone retrieval.
    Falls back to original text if nothing extracted or if NER is not loaded.
    """
    if nlp is None:
        return text

    try:
        doc = nlp(text)
        entities = [ent.text for ent in doc.ents]

        if entities:
            # Join extracted terms as search query
            enriched = " ".join(entities)
            print(f"[INFO] NER extracted: {entities}")
            return enriched
        else:
            # No medical terms found, use original
            print("[INFO] NER: no entities found, using original message")
            return text

    except Exception as e:
        print(f"[ERROR] NER error: {e}")
        return text  # always fall back safely