from datasets import load_dataset
from pinecone import Pinecone
from fastembed import TextEmbedding
from tqdm import tqdm
import os
from dotenv import load_dotenv

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX   = os.getenv("PINECONE_INDEX_NAME")

pc       = Pinecone(api_key=PINECONE_API_KEY)
index    = pc.Index(PINECONE_INDEX)
class FastEmbedWrapper:
    def __init__(self, model_name="sentence-transformers/all-MiniLM-L6-v2"):
        self.model = TextEmbedding(model_name=model_name)
    
    def encode(self, text_or_list):
        if isinstance(text_or_list, str):
            return list(self.model.embed([text_or_list]))[0]
        else:
            import numpy as np
            return np.array(list(self.model.embed(text_or_list)))

embedder = FastEmbedWrapper()

print("⏳ Loading HealthCareMagic dataset...")
ds = load_dataset("lavita/ChatDoctor-HealthCareMagic-100k", split="train")
ds = ds.select(range(10000))  # 10k rows — enough, fast, won't hit free tier limits
print(f"✅ Loaded {len(ds)} rows")

BATCH_SIZE = 100
vectors    = []

for i, row in enumerate(tqdm(ds, desc="📤 Uploading to Pinecone [healthcaremagic namespace]")):
    patient_q  = row.get("input", "").strip()
    doctor_ans = row.get("output", "").strip()

    if not patient_q or not doctor_ans:
        continue

    text = f"Patient: {patient_q}\nDoctor: {doctor_ans}"

    embedding = embedder.encode(text).tolist()

    vectors.append({
        "id": f"hcm-{i}",
        "values": embedding,
        "metadata": {
            "text": text,
            "source": "HealthCareMagic",
        }
    })

    if len(vectors) >= BATCH_SIZE:
        index.upsert(vectors=vectors, namespace="healthcaremagic")  # ← namespace here
        vectors = []

if vectors:
    index.upsert(vectors=vectors, namespace="healthcaremagic")

print("✅ Done! HealthCareMagic uploaded to namespace: healthcaremagic")
print("✅ Your Gale data in default namespace is completely untouched.")