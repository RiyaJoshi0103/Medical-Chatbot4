import csv
import json
import os
from collections import defaultdict

def main():
    # Input path
    csv_path = r"C:\Users\Riya Joshi\IgnitersAssignments\poc\backend\data\ddi_interactions_clean.csv"
    
    # Output paths
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(backend_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    json_path = os.path.join(data_dir, "ddi_interactions.json")

    print(f"Reading from: {csv_path}")
    
    if not os.path.exists(csv_path):
        print(f"Error: Raw CSV file not found at {csv_path}")
        return

    interactions = defaultdict(dict)
    count = 0
    skipped = 0

    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            drug_a = row["Drug_A"].strip().lower()
            drug_b = row["Drug_B"].strip().lower()
            severity = row["severity"].strip().upper()

            # Keep only HIGH and MEDIUM severity levels
            if severity in ("HIGH", "MEDIUM"):
                interactions[drug_a][drug_b] = severity
                interactions[drug_b][drug_a] = severity
                count += 1
            else:
                skipped += 1

    print(f"Successfully processed {count} interactions (skipped {skipped} low/unknown interactions)")
    print(f"Total unique drugs with interactions: {len(interactions)}")

    # Write to JSON
    with open(json_path, mode="w", encoding="utf-8") as f:
        json.dump(interactions, f, indent=2)

    print(f"Optimized database written to: {json_path}")

if __name__ == "__main__":
    main()
