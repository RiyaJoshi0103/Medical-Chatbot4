import sys
import os

# Ensure main directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import detect_drugs, ddi_drug_list, ddi_data, medicine_data, check_contraindications

def run_tests():
    print("[INFO] Running DDI Integration Tests...")

    # Test 1: Data Loaded
    assert len(ddi_drug_list) > 0, "[ERROR] Failed: ddi_drug_list is empty"
    assert len(ddi_data) > 0, "[ERROR] Failed: ddi_data is empty"
    print(f"[OK] Successfully loaded {len(ddi_drug_list)} drugs and interactions.")

    # Test 2: Word Boundary Detection
    message = "I am taking fluoxetine and meperidine."
    detected = detect_drugs(message, ddi_drug_list)
    assert "fluoxetine" in detected, f"[ERROR] Failed: Could not detect fluoxetine in message. Detected: {detected}"
    assert "meperidine" in detected, f"[ERROR] Failed: Could not detect meperidine in message. Detected: {detected}"
    print("[OK] Detected exact drug matches.")

    # Test 3: Substring False Positives
    message_neg = "I took some medicine with tin and spin and meperidinetin."
    detected_neg = detect_drugs(message_neg, ddi_drug_list)
    assert len(detected_neg) == 0, f"[ERROR] Failed: Substring matches detected incorrectly: {detected_neg}"
    print("[OK] Prevented false-positive substring matches.")

    # Test 4: Multi-Word Drug Detection
    message_multi = "My doctor prescribed mefenamic acid and insulin glargine."
    detected_multi = detect_drugs(message_multi, ddi_drug_list)
    assert "mefenamic acid" in detected_multi, f"[ERROR] Failed: Could not detect mefenamic acid. Detected: {detected_multi}"
    assert "insulin glargine" in detected_multi, f"[ERROR] Failed: Could not detect insulin glargine. Detected: {detected_multi}"
    print("[OK] Detected multi-word drug names.")

    # Test 5: Interaction Checking Logic
    alerts = []
    # Check interaction between meperidine and fluoxetine (should be HIGH/Major)
    d1 = "meperidine"
    d2 = "fluoxetine"
    if d2 in ddi_data.get(d1, {}):
        alerts.append((d1, d2, ddi_data[d1][d2]))
    
    assert len(alerts) == 1, "[ERROR] Interaction not detected"
    assert alerts[0] == ("meperidine", "fluoxetine", "HIGH"), f"[ERROR] Failed: Incorrect severity or pair. Detected: {alerts[0]}"
    print("[OK] Verified HIGH severity interaction detection.")

    # Check interaction between morphine and spironolactone (should be MEDIUM/Moderate)
    alerts_med = []
    da = "morphine"
    dw = "spironolactone"
    if dw in ddi_data.get(da, {}):
        alerts_med.append((da, dw, ddi_data[da][dw]))
    
    assert len(alerts_med) == 1, "[ERROR] Interaction not detected"
    assert alerts_med[0] == ("morphine", "spironolactone", "MEDIUM"), f"[ERROR] Failed: Incorrect severity or pair. Detected: {alerts_med[0]}"
    print("[OK] Verified MEDIUM severity interaction detection.")

    # Test 6: Contraindications Database Loading
    assert len(medicine_data) > 0, "[ERROR] Failed: medicine_data is empty"
    print(f"[OK] Successfully loaded {len(medicine_data)} medicines.")

    # Test 7: Programmatic Contraindication Check (aspirin + kidney disease)
    alerts_contra = check_contraindications(["kidney disease"], ["aspirin"])
    assert len(alerts_contra) == 1, f"[ERROR] Failed: Contraindication not detected. Alerts: {alerts_contra}"
    assert alerts_contra[0]["medicine"] == "aspirin", f"[ERROR] Failed: Incorrect medicine: {alerts_contra[0]}"
    assert "renal" in alerts_contra[0]["contraindication"], f"[ERROR] Failed: Incorrect contraindication match: {alerts_contra[0]}"
    print("[OK] Verified drug-disease contraindication detection (aspirin + kidney disease).")

    # Test 8: Negative Contraindication Check (acetaminophen + diabetes)
    # acetaminophen has kidney/liver/alcohol contraindications but not diabetes.
    alerts_contra_neg = check_contraindications(["diabetes"], ["acetaminophen"])
    assert len(alerts_contra_neg) == 0, f"[ERROR] Failed: False contraindication triggered: {alerts_contra_neg}"
    print("[OK] Verified false-positive contraindications are rejected.")

    # Test 8.5: Clinical Override (paracetamol/acetaminophen + kidney disease/renal failure)
    alerts_override_paracetamol = check_contraindications(["kidney disease"], ["paracetamol"])
    assert len(alerts_override_paracetamol) == 0, f"[ERROR] Failed: Paracetamol warning not overridden for kidney disease: {alerts_override_paracetamol}"
    alerts_override_acetaminophen = check_contraindications(["renal failure"], ["acetaminophen"])
    assert len(alerts_override_acetaminophen) == 0, f"[ERROR] Failed: Acetaminophen warning not overridden for renal failure: {alerts_override_acetaminophen}"
    print("[OK] Clinical override successfully skipped warnings for paracetamol/acetaminophen with kidney disease.")

    # Test 9: Consulting Mode (for_family) Bypass Check
    print("[INFO] Testing for_family bypass logic...")
    import asyncio
    from unittest.mock import MagicMock, patch
    from main import chat, ChatRequest, session_memory
    import json

    session_id = "test_session_for_family"
    if session_id in session_memory:
        del session_memory[session_id]

    req_myself = ChatRequest(
        message="I want to take ibuprofen",
        session_id=session_id,
        language="en",
        for_family=False
    )
    # Manually populate session memory with chronic condition
    session_memory[session_id] = {
        "turns": 0,
        "greeted": True,
        "chronic_conditions": ["kidney disease"],
        "history": []
    }

    # Mock groq completion return value
    mock_choice = MagicMock()
    mock_choice.message.content = json.dumps({
        "reply": "You can take ibuprofen for pain.",
        "intent": "symptom_check",
        "entities": {
            "possible_diseases": ["pain"],
            "symptoms": ["pain"],
            "home_remedies": [],
            "detected_chronic_conditions": []
        }
    })

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    with patch("main.client.chat.completions.create", return_value=mock_response):
        # Run myself chat
        res_myself = asyncio.run(chat(req_myself))
        # It should trigger contraindication alert since it is myself
        assert len(res_myself.entities.get("contraindication_alerts", [])) > 0, "[ERROR] Failed: Myself mode did not trigger contraindication alerts"
        print("[OK] Myself mode successfully triggered contraindication alerts.")

        # Mode 2: For Family (should bypass contraindication)
        req_family = ChatRequest(
            message="I want to take ibuprofen",
            session_id=session_id,
            language="en",
            for_family=True
        )

        res_family = asyncio.run(chat(req_family))
        # It should NOT trigger contraindication alert since it is for family
        assert len(res_family.entities.get("contraindication_alerts", [])) == 0, f"[ERROR] Failed: Family mode triggered contraindication alerts: {res_family.entities.get('contraindication_alerts')}"
        print("[OK] Family mode successfully bypassed contraindication alerts.")

        # Test 10: Persistent Profile memory functions
        from main import load_user_profile, save_user_profile, USER_PROFILES_FILE
        test_email = "test_memory@example.com"
        save_user_profile(test_email, {"chronic_conditions": ["kidney disease"]})
        loaded = load_user_profile(test_email)
        assert loaded.get("chronic_conditions") == ["kidney disease"], f"[ERROR] Failed: load_user_profile returned incorrect data: {loaded}"
        print("[OK] User profile successfully saved and loaded.")

        # Test 11: End-to-end user profile loading in /chat
        session_id_mem = "test_session_memory_flow"
        if session_id_mem in session_memory:
            del session_memory[session_id_mem]
        
        req_mem = ChatRequest(
            message="Hello",
            session_id=session_id_mem,
            language="en",
            user_email=test_email
        )
        
        # Mock completion
        mock_choice_mem = MagicMock()
        mock_choice_mem.message.content = json.dumps({
            "reply": "How can I help you?",
            "intent": "greeting",
            "entities": {
                "possible_diseases": [],
                "symptoms": [],
                "home_remedies": [],
                "detected_chronic_conditions": []
            }
        })
        mock_response_mem = MagicMock()
        mock_response_mem.choices = [mock_choice_mem]
        
        with patch("main.client.chat.completions.create", return_value=mock_response_mem):
            res_mem = asyncio.run(chat(req_mem))
            assert "kidney disease" in res_mem.entities.get("chronic_conditions", []), f"[ERROR] Failed: Profile conditions not loaded in chat response: {res_mem.entities}"
            assert "kidney disease" in session_memory[session_id_mem]["chronic_conditions"], "[ERROR] Failed: Profile conditions not merged into session"
            print("[OK] Persistent user profile chronic conditions successfully loaded and merged in /chat.")

            # Test 12: Updating chronic conditions saves back to profile
            req_mem_update = ChatRequest(
                message="I have diabetes",
                session_id=session_id_mem,
                language="en",
                user_email=test_email
            )
            # Simulate diabetes detection by LLM
            mock_choice_update = MagicMock()
            mock_choice_update.message.content = json.dumps({
                "reply": "You mentioned diabetes.",
                "intent": "symptom_check",
                "entities": {
                    "possible_diseases": [],
                    "symptoms": [],
                    "home_remedies": [],
                    "detected_chronic_conditions": ["diabetes"]
                }
            })
            mock_response_update = MagicMock()
            mock_response_update.choices = [mock_choice_update]
            
            with patch("main.client.chat.completions.create", return_value=mock_response_update):
                res_update = asyncio.run(chat(req_mem_update))
                loaded_updated = load_user_profile(test_email)
                assert "kidney disease" in loaded_updated.get("chronic_conditions", []), f"[ERROR] Failed: kidney disease lost in profile: {loaded_updated}"
                assert "diabetes" in loaded_updated.get("chronic_conditions", []), f"[ERROR] Failed: diabetes not saved in profile: {loaded_updated}"
                print("[OK] User profile updated and saved with new chronic conditions in /chat.")

        # Cleanup profiles file test email
        if os.path.exists(USER_PROFILES_FILE):
            try:
                with open(USER_PROFILES_FILE, "r", encoding="utf-8") as f:
                    profs = json.load(f)
                if test_email in profs:
                    del profs[test_email]
                with open(USER_PROFILES_FILE, "w", encoding="utf-8") as f:
                    json.dump(profs, f, indent=2)
            except Exception:
                pass

    print("\n[OK] All programmatic DDI & Contraindication tests passed successfully!")

if __name__ == "__main__":
    run_tests()
