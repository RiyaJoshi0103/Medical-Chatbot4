"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Mic,
  MicOff,
  Stethoscope,
  Globe,
  Volume2,
  VolumeX,
  FileText,
  Menu,
  X,
  ChevronRight,
  MessageSquare,
  Clock,
  Plus,
  Sparkles,
  Paperclip,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

type Message = {
  sender: "user" | "bot";
  text: string;
  image?: string;
  ddiAlerts?: Array<{ drug_a: string; drug_b: string; severity: string }>;
  contraindicationAlerts?: Array<{ medicine: string; chronic_condition: string; contraindication: string }>;
  suggestedMedicines?: string[];
  injuryData?: {
    category: string;
    injury_type?: string;
    severity?: string;
    first_aid_steps?: string[];
    home_remedies?: string[];
  };
};

type Session = {
  id: string;
  started_at: string;
  language: string;
  message_count: number;
};

const GREETINGS: Record<string, string> = {
  en: "Hello! I'm your personal health assistant. Describe your symptoms or ask any health question — I'm here to help.",
  hi: "नमस्ते! मैं आपका स्वास्थ्य सहायक हूँ। अपने लक्षण बताएं — मैं आपकी मदद के लिए यहाँ हूँ।",
  pahadi: "राम राम! म तुम्हर स्वास्थ्य सहायक छु। अपणि तकलीफ बताओ।",
  garhwali: "राम राम! म तुमर स्वास्थ्य सहायक छौं। अपणि तकलीफ बताओ।"
};

const PLACEHOLDERS: Record<string, string> = {
  en: "Describe your symptoms...",
  hi: "अपने लक्षण बताएं...",
  pahadi: "अपणि तकलीफ बताओ...",
  garhwali: "अपणि तकलीफ बताओ...",
};

const LANG_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  pahadi: "Pahadi",
  garhwali: "Garhwali",
};

// ── Outside component — plain JS variable, no closure issues ──
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") || "";

let globalLanguage = "en";

const DRUG_TRANSLITERATIONS: Record<string, string[]> = {
  "paracetamol": ["पैरासिटामोल", "पैरसिटामोल", "पैरासिटामॉल", "पैरसिटामॉल", "paracetamol"],
  "ibuprofen": ["आइबूप्रोफेन", "आइबुप्रोफेन", "इबुप्रोफेन", "इबूप्रोफेन", "इबुप्रोफ़ेन", "आइबुप्रोफ़ेन", "ibuprofen"],
  "aspirin": ["एस्पिरिन", "ऐस्पिरिन", "aspirin"],
  "cetirizine": ["सिट्रीजीन", "सेट्रीजीन", "सिट्रिजिन", "cetirizine"],
  "amoxicillin": ["अमोक्सिसिलिन", "एमोक्सिसिलिन", "amoxicillin"],
  "ors": ["ओआरएस", "ओ.आर.एस.", "ors"],
  "diclofenac": ["डाइक्लोफेनाक", "डिक्लोफेनेक", "diclofenac"],
  "ranitidine": ["रैनिटिडीन", "ranitidine"],
  "pantoprazole": ["पेंटाप्रोजोल", "पेन्टोप्राजोल", "pantoprazole"]
};

const CONDITION_TRANSLATIONS: Record<string, string> = {
  "kidney disease": "किडनी की बीमारी",
  "renal failure": "किडनी फेलियर",
  "diabetes": "मधुमेह (शुगर)",
  "asthma": "दमा (अस्थमा)",
  "liver disease": "लिवर की बीमारी",
  "heart disease": "दिल की बीमारी",
  "anemia": "खून की कमी (एनीमिया)",
  "hypertension": "हाई बीपी (उच्च रक्तचाप)",
};

const SUGGESTED_TAGS: Record<string, string> = {
  en: "Suggested Option",
  hi: "सुझाव",
  pahadi: "सलाह",
  garhwali: "सलाह",
};

const SUGGESTED_TEXTS: Record<string, string> = {
  en: "is a suitable option to consider.",
  hi: "एक उपयुक्त विकल्प है।",
  pahadi: "एक ठीक विकल्प छ।",
  garhwali: "एक ठीक विकल्प छ।",
};

const renderMessageText = (msg: Message) => {
  if (msg.sender === "user" || !msg.suggestedMedicines || msg.suggestedMedicines.length === 0) {
    return <span>{msg.text}</span>;
  }

  // Gather all variants of detected drugs (Devanagari + English)
  const variants: string[] = [];
  msg.suggestedMedicines.forEach(med => {
    const medLower = med.toLowerCase();
    const list = DRUG_TRANSLITERATIONS[medLower] || [medLower];
    list.forEach(v => {
      if (!variants.includes(v)) variants.push(v);
    });
  });

  // Sort by length descending to match longest matches first
  variants.sort((a, b) => b.length - a.length);

  // Escape regex special chars
  const escapedVariants = variants.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${escapedVariants.join('|')})\\b|(${escapedVariants.join('|')})`, 'gi');

  const parts = msg.text.split(pattern);
  // Filter out undefined and empty string parts from splitting groups
  const cleanParts = parts.filter(p => p !== undefined && p !== "");

  if (cleanParts.length === 1) return <span>{msg.text}</span>;

  return (
    <span>
      {cleanParts.map((part, idx) => {
        const isMed = variants.some(v => v.toLowerCase() === part.toLowerCase());
        if (isMed) {
          return (
            <span key={idx} className="font-bold text-emerald-600 dark:text-emerald-400 capitalize">
              {part}
            </span>
          );
        }
        return part;
      })}
    </span>
  );
};


function ChatAssistantPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const isLogout = searchParams.get("logout") === "true";
    
    if (isLogout) {
      localStorage.removeItem("chatbot_user_name");
      localStorage.removeItem("chatbot_user_email");
      setUserName("");
      setUserEmail("");
      setIsLoggedIn(false);
      return;
    }

    const paramName = searchParams.get("name");
    const paramEmail = searchParams.get("email");

    let finalName = "";
    let finalEmail = "";

    if (paramEmail) {
      finalName = paramName || "";
      finalEmail = paramEmail;
      localStorage.setItem("chatbot_user_name", finalName);
      localStorage.setItem("chatbot_user_email", finalEmail);
    } else {
      finalName = localStorage.getItem("chatbot_user_name") || "";
      finalEmail = localStorage.getItem("chatbot_user_email") || "";
    }

    setUserName(finalName);
    setUserEmail(finalEmail);
    setIsLoggedIn(!!finalEmail);
  }, [searchParams]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [language, setLanguage] = useState("en");
  const [lastInputWasVoice, setLastInputWasVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [sessionMessages, setSessionMessages] = useState<Message[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [chronicConditions, setChronicConditions] = useState<string[]>([]);
  const [consultingFor, setConsultingFor] = useState<"myself" | "family">("myself");

  const loadUserProfile = async (email: string) => {
    if (!email) return;
    try {
      const res = await fetch(`${BACKEND_URL}/profile?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.chronic_conditions) {
          setChronicConditions(data.chronic_conditions);
        }
      }
    } catch (e) {
      console.error("Failed to load user profile:", e);
    }
  };

  useEffect(() => {
    if (userEmail) {
      loadUserProfile(userEmail);
    } else {
      setChronicConditions([]);
    }
  }, [userEmail]);

  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const dbSessionIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Set initial greeting ──
  useEffect(() => {
    setMessages([{ sender: "bot", text: GREETINGS["en"] }]);
  }, []);

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Load sessions when sidebar opens ──
  useEffect(() => {
    if (!sidebarOpen || !isLoggedIn) return;
    setLoadingSessions(true);
    fetch(`/api/chat-messages?email=${encodeURIComponent(userEmail)}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions || []);
        setLoadingSessions(false);
      })
      .catch(() => setLoadingSessions(false));
  }, [sidebarOpen]);

  // ── Load messages for a past session ──
  const loadSessionMessages = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    try {
      const res = await fetch(`/api/chat-history?sessionId=${sessionId}`);
      const data = await res.json();
      setSessionMessages(
        (data.messages || []).map((m: any) => ({
          sender: m.sender,
          text: m.message,
        })),
      );
    } catch (e) {
      console.error("Failed to load session messages:", e);
    }
  };

  // ── Language change ──
  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    globalLanguage = newLang;
    setMessages((prev) => {
      const conversationStarted = prev.some((m) => m.sender === "user");
      if (conversationStarted) return prev;
      return [{ sender: "bot", text: GREETINGS[newLang] }];
    });
  };

  // ── Text-to-speech ──
  const speakResponse = (text: string) => {
    if (muted || !lastInputWasVoice || typeof window === "undefined") return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "en" ? "en-US" : "hi-IN";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const toggleMute = () => {
    if (!muted) window.speechSynthesis.cancel();
    setMuted((prev) => !prev);
  };

  // ── Save message to DB (creates session on first message) ──
  const saveMessage = async (
    sender: "user" | "bot",
    message: string,
    currentLang: string = language,
  ) => {
    if (!isLoggedIn) return;
    try {
      // Create DB session lazily on first message
      if (!dbSessionIdRef.current) {
        const res = await fetch("/api/chat-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userEmail, userName, language: currentLang }),
        });
        const d = await res.json();
        if (!d.sessionId) throw new Error("No sessionId returned");
        dbSessionIdRef.current = d.sessionId;
      }

      await fetch("/api/chat-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: dbSessionIdRef.current,
          sender,
          message,
        }),
      });
    } catch (e) {
      console.error("saveMessage error:", e);
    }
  };

  // ── Voice input ──
  const startListening = async () => {
    if (typeof window === "undefined") return;

    if (listening) {
      (window as any)._mediaRecorder?.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: BlobPart[] = [];
      const capturedLang = globalLanguage;
      const recordingStartTime = Date.now();

      console.log("🎤 Mic started, language =", capturedLang);

      (window as any)._mediaRecorder = mediaRecorder;
      setListening(true);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        // ✅ Immediately stop the red listening state — don't wait for the API
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });

        // ✅ Guard: skip if audio blob is too small (empty/no speech recorded)
        if (audioBlob.size < 3000) {
          console.warn("⚠️ Audio blob too small, skipping transcription:", audioBlob.size, "bytes");
          return;
        }

        const formData = new FormData();
        formData.append("file", audioBlob, "audio.webm");

        console.log("🎤 Sending to /transcribe:", capturedLang, `${(audioBlob.size / 1024).toFixed(1)} KB`);
        setTranscribing(true);

        // ✅ AbortController: cancel the fetch if it takes more than 20 seconds
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          console.error("❌ Transcription timed out after 20s");
        }, 20000);

        try {
          const res = await fetch(
            `${BACKEND_URL}/transcribe?language=${capturedLang}`,
            { method: "POST", body: formData, signal: controller.signal },
          );
          clearTimeout(timeoutId);
          const data = await res.json();
          console.log("✅ Transcription received:", data.text);
          if (data.text) {
            setInput(data.text);
            setLastInputWasVoice(true);
          }
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err?.name === "AbortError") {
            console.error("❌ Transcription request timed out.");
          } else {
            console.error("Transcription error:", err);
          }
        } finally {
          setTranscribing(false);
        }
      };

      // ✅ Collect audio every 250ms so chunks are always available
      mediaRecorder.start(250);

      // ── Silence Detection ──
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioContext = new AudioContextClass();
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);

          analyser.fftSize = 512;
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const silenceThreshold = 12; // Audio volume threshold (0-255)
          const silenceDelay = 2000;   // Auto-stop after 2 seconds of silence
          const minRecordingMs = 800;  // ✅ Always record at least 800ms before auto-stopping
          let silenceStart = Date.now();
          let speechDetected = false;

          const checkSilence = () => {
            if (mediaRecorder.state !== "recording") {
              source.disconnect();
              analyser.disconnect();
              audioContext.close().catch(() => {});
              return;
            }

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
              sum += dataArray[i];
            }
            const averageVolume = sum / bufferLength;

            const now = Date.now();
            const elapsed = now - recordingStartTime;

            if (averageVolume > silenceThreshold) {
              speechDetected = true;
              silenceStart = now;
            }

            // ✅ Only auto-stop after minimum recording time has passed
            if (elapsed > minRecordingMs) {
              const maxSilenceDuration = speechDetected ? silenceDelay : 6000;
              if (now - silenceStart > maxSilenceDuration) {
                console.log(
                  speechDetected
                    ? "🎤 Silence detected. Auto-stopping microphone..."
                    : "🎤 No speech detected. Auto-stopping microphone..."
                );
                if (mediaRecorder.state === "recording") {
                  mediaRecorder.stop();
                }
                return;
              }
            }

            requestAnimationFrame(checkSilence);
          };

          requestAnimationFrame(checkSilence);
        }
      } catch (audioErr) {
        console.warn("Silence detection failed to initialize:", audioErr);
      }
    } catch (err) {
      alert("Microphone access denied. Please allow mic access and try again.");
      setListening(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert("Please select an image file.");
        return;
      }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeSelectedImage = () => {
    setSelectedFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // ── Send message ──
  const handleSend = async () => {
    if (!input.trim() && !selectedFile) return;

    const userInput = input.trim();
    const userMessage: Message = {
      sender: "user",
      text: userInput || "[Uploaded Image]",
      image: imagePreview || undefined,
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    
    const fileToSend = selectedFile;
    setSelectedFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    
    setLoading(true);

    // Save user message with current language
    await saveMessage("user", userInput || "[Uploaded Image]", globalLanguage);

    try {
      let res;
      if (fileToSend) {
        const formData = new FormData();
        formData.append("file", fileToSend);
        formData.append("session_id", sessionIdRef.current);
        formData.append("language", globalLanguage);
        formData.append("for_family", String(consultingFor === "family"));
        if (userEmail) {
          formData.append("user_email", userEmail);
        }
        res = await fetch(`${BACKEND_URL}/chat/analyze-image`, {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch(`${BACKEND_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionIdRef.current,
            message: userInput,
            language: globalLanguage,
            for_family: consultingFor === "family",
            user_email: userEmail || null,
          }),
        });
      }

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const data = await res.json();
      const botReply: Message = {
        sender: "bot",
        text: data.reply || "Something went wrong. Please try again.",
        ddiAlerts: data.entities?.ddi_alerts || [],
        contraindicationAlerts: data.entities?.contraindication_alerts || [],
        suggestedMedicines: data.entities?.suggested_medicines || [],
        injuryData: data.entities?.category === "injury_skin" ? {
          category: data.entities.category,
          injury_type: data.entities.injury_type,
          severity: data.entities.severity,
          first_aid_steps: data.entities.first_aid_steps,
          home_remedies: data.entities.home_remedies
        } : undefined
      };

      if (data.entities?.chronic_conditions) {
        setChronicConditions(data.entities.chronic_conditions);
      }

      setMessages((prev) => [...prev, botReply]);
      speakResponse(botReply.text);

      // Save bot reply with same language
      await saveMessage("bot", botReply.text, globalLanguage);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: "Unable to connect. Please check your connection and try again.",
        },
      ]);
    } finally {
      setLoading(false);
      setLastInputWasVoice(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !loading && (input.trim() || selectedFile)) {
      setLastInputWasVoice(false);
      handleSend();
    }
  };

  // ── Generate report ──
  const handleOpenReport = () => {
    const reportData = {
      messages,
      language,
      timestamp: new Date().toISOString(),
      user: { name: userName, email: userEmail },
    };
    sessionStorage.setItem("chatReportData", JSON.stringify(reportData));
    router.push("/report");
  };

  // ── FIX: Start new chat — reset ALL session refs ──
  const startNewChat = () => {
    setSelectedSessionId(null);
    setSessionMessages([]);
    setSidebarOpen(false);
    sessionIdRef.current = crypto.randomUUID(); // reset FastAPI session
    dbSessionIdRef.current = null; // reset DB session so new one is created
    if (!isLoggedIn) {
      setChronicConditions([]);
    } else {
      loadUserProfile(userEmail);
    }
    setConsultingFor("myself"); // Reset toggle mode
    setMessages([{ sender: "bot", text: GREETINGS[language] }]); // fresh greeting
  };

  const displayMessages = selectedSessionId ? sessionMessages : messages;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Lora:ital@0;1&display=swap');
        * { font-family: 'Outfit', sans-serif; }
        :root {
          --green-900: #064e3b; --green-800: #065f46; --green-700: #047857;
          --green-600: #059669; --green-500: #10b981; --green-400: #34d399;
          --green-300: #6ee7b7; --green-100: #d1fae5; --green-50: #ecfdf5;
        }
        .chat-scrollbar::-webkit-scrollbar { width: 4px; }
        .chat-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .chat-scrollbar::-webkit-scrollbar-thumb { background: var(--green-200, #a7f3d0); border-radius: 99px; }
        .glass-card { background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .listening-ring { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); animation: pulse-ring 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
          50% { box-shadow: 0 0 0 10px rgba(16,185,129,0); }
        }
      `}</style>

      {/* ── SIDEBAR ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="fixed top-0 left-0 h-full z-50 flex flex-col"
              style={{
                width: "300px",
                background:
                  "linear-gradient(160deg, #064e3b 0%, #065f46 40%, #047857 100%)",
              }}>
              <div className="px-5 py-6 relative">
                <div
                  className="absolute inset-0 opacity-10"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 70% 20%, #34d399 0%, transparent 60%)",
                  }}
                />
                <div className="relative flex items-center justify-between mb-1">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center">
                      <Stethoscope
                        className="w-4.5 h-4.5 text-emerald-200"
                        style={{ width: "18px", height: "18px" }}
                      />
                    </div>
                    <div>
                      <p className="text-white font-semibold text-sm tracking-tight">
                        Chat History
                      </p>
                      <p className="text-emerald-300 text-xs mt-0.5 truncate max-w-[140px]">
                        {isLoggedIn ? userName || userEmail : "Guest Session"}
                      </p>
                    </div>
                  </div>
                  <button
                    suppressHydrationWarning
                    onClick={() => setSidebarOpen(false)}
                    className="p-2 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="px-4 pb-3">
                <button
                  suppressHydrationWarning
                  onClick={startNewChat}
                  className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/15 border border-white/20 text-white text-sm font-medium hover:bg-white/25 transition-all group">
                  <div className="w-6 h-6 rounded-lg bg-emerald-400/30 flex items-center justify-center group-hover:bg-emerald-400/50 transition-all">
                    <Plus className="w-3.5 h-3.5 text-emerald-200" />
                  </div>
                  Start New Conversation
                </button>
              </div>

              <div className="mx-4 h-px bg-white/10 mb-3" />

              <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1 chat-scrollbar">
                {!isLoggedIn ? (
                  <div className="mt-10 px-4 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-3">
                      <MessageSquare className="w-5 h-5 text-emerald-300" />
                    </div>
                    <p className="text-emerald-200 text-xs leading-relaxed font-light">
                      Sign in to access your full conversation history
                    </p>
                  </div>
                ) : loadingSessions ? (
                  <div className="flex items-center justify-center mt-10">
                    <div className="w-5 h-5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="mt-10 px-4 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-3">
                      <Clock className="w-5 h-5 text-emerald-300/60" />
                    </div>
                    <p className="text-emerald-300/60 text-xs font-light">
                      No previous conversations
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-emerald-400/70 px-3 pt-1 pb-2 font-medium uppercase tracking-widest">
                      Recent
                    </p>
                    {sessions.map((s) => (
                      <button
                        suppressHydrationWarning
                        key={s.id}
                        onClick={() => {
                          loadSessionMessages(s.id);
                          setSidebarOpen(false);
                        }}
                        className={`w-full text-left px-3 py-3 rounded-2xl transition-all group ${
                          selectedSessionId === s.id
                            ? "bg-white/20 border border-white/25"
                            : "hover:bg-white/10 border border-transparent"
                        }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span className="text-xs font-medium text-white/80 truncate">
                            {s.message_count} messages ·{" "}
                            {LANG_LABELS[s.language] || s.language}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 pl-5">
                          <Clock className="w-3 h-3 text-emerald-400/50" />
                          <span className="text-xs text-emerald-300/50">
                            {new Date(s.started_at).toLocaleDateString(
                              "en-IN",
                              {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </span>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>

              {isLoggedIn && (
                <div className="px-4 py-4 border-t border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-emerald-400/30 border border-emerald-400/30 flex items-center justify-center">
                      <span className="text-emerald-200 text-xs font-bold">
                        {userName
                          ? userName[0].toUpperCase()
                          : userEmail[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white/90 truncate">
                        {userName || "User"}
                      </p>
                      <p className="text-xs text-emerald-300/60 truncate">
                        {userEmail}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── PAGE WRAPPER ── */}
      <div
        className="min-h-screen flex flex-col relative overflow-hidden"
        style={{
          background:
            "linear-gradient(145deg, #ecfdf5 0%, #f0fdf4 30%, #f8fafc 60%, #ecfdf5 100%)",
        }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-20"
            style={{
              background:
                "radial-gradient(circle, #10b981 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full opacity-10"
            style={{
              background:
                "radial-gradient(circle, #059669 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-5"
            style={{
              background:
                "radial-gradient(circle, #34d399 0%, transparent 60%)",
            }}
          />
        </div>

        {/* ══ NAVBAR ══ */}
        <nav
          className="glass-card border-b border-emerald-100/80 px-5 py-3.5 flex items-center justify-between sticky top-0 z-30"
          style={{
            boxShadow:
              "0 1px 20px rgba(16,185,129,0.08), 0 1px 3px rgba(0,0,0,0.04)",
          }}>
          <div className="flex items-center gap-3">
            <button
              suppressHydrationWarning
              onClick={() => setSidebarOpen(true)}
              className="w-9 h-9 rounded-xl border border-emerald-200/70 flex items-center justify-center hover:bg-emerald-50 transition-all text-emerald-600"
              style={{ background: "rgba(236,253,245,0.8)" }}
              title="Chat History">
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-2xl flex items-center justify-center relative overflow-hidden"
                style={{
                  background:
                    "linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)",
                }}>
                <Stethoscope
                  className="w-4.5 h-4.5 text-white relative z-10"
                  style={{ width: "18px", height: "18px" }}
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 leading-tight tracking-tight">
                  {selectedSessionId ? "Past Conversation" : "Health Assistant"}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-gray-400 font-light">
                    {isLoggedIn
                      ? `Welcome back, ${userName.split(" ")[0]}`
                      : "Online · Ready to help"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedSessionId && (
              <button
                suppressHydrationWarning
                onClick={startNewChat}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90"
                style={{
                  background: "linear-gradient(135deg, #059669, #10b981)",
                }}>
                <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                Current Chat
              </button>
            )}
            {!selectedSessionId && (
              <div
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 border border-emerald-200/60 hover:border-emerald-400 transition-all cursor-pointer"
                style={{ background: "rgba(236,253,245,0.7)" }}>
                <Globe className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <select
                  suppressHydrationWarning
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="bg-transparent text-gray-600 text-xs font-medium outline-none cursor-pointer">
                  <option value="en">English</option>
                  <option value="hi">हिंदी</option>
                  <option value="pahadi">पहाड़ी</option>
                  <option value="garhwali">गढ़वाली</option>
                </select>
              </div>
            )}
            <button
              suppressHydrationWarning
              onClick={toggleMute}
              title={muted ? "Unmute" : "Mute"}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                muted
                  ? "bg-red-50 border-red-200 text-red-500"
                  : "border-emerald-200/60 text-gray-500 hover:border-emerald-400 hover:text-emerald-700"
              }`}
              style={!muted ? { background: "rgba(236,253,245,0.7)" } : {}}>
              {muted ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {muted ? "Unmute" : "Mute"}
              </span>
            </button>
            {!selectedSessionId && (
              <button
                suppressHydrationWarning
                onClick={handleOpenReport}
                disabled={messages.length <= 1}
                title="Generate Report"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                  messages.length > 1
                    ? "border-emerald-300 text-emerald-700 hover:border-emerald-500"
                    : "border-gray-200 text-gray-300 cursor-not-allowed"
                }`}
                style={
                  messages.length > 1
                    ? { background: "rgba(236,253,245,0.7)" }
                    : { background: "rgba(249,250,251,0.7)" }
                }>
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Report</span>
              </button>
            )}
          </div>
        </nav>

        {/* ══ CHAT WINDOW ══ */}
        <div className="flex-1 flex items-center justify-center px-4 py-5 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-2xl flex flex-col rounded-3xl overflow-hidden"
            style={{
              height: "calc(100vh - 120px)",
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(24px)",
              boxShadow:
                "0 24px 80px rgba(16,185,129,0.12), 0 8px 24px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
              border: "1px solid rgba(209,250,229,0.8)",
            }}>
            {/* Chat header */}
            <div
              className="px-5 py-4 flex items-center gap-3 relative overflow-hidden"
              style={{
                background:
                  "linear-gradient(135deg, #047857 0%, #059669 50%, #10b981 100%)",
              }}>
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 80% 50%, #34d399 0%, transparent 60%)",
                }}
              />
              <div className="w-10 h-10 rounded-2xl bg-white/20 border border-white/25 flex items-center justify-center relative z-10">
                <Stethoscope className="w-5 h-5 text-white" />
              </div>
              <div className="relative z-10">
                <p className="text-white font-semibold text-sm tracking-tight">
                  Health Assistant
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  <span className="text-emerald-100 text-xs font-light">
                    AI-powered · Always available
                  </span>
                </div>
              </div>
              <div className="ml-auto relative z-10">
                <div className="flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-xl px-3 py-1.5">
                  <Sparkles className="w-3 h-3 text-emerald-200" />
                  <span className="text-emerald-100 text-xs font-medium">
                    Smart Health AI
                  </span>
                </div>
              </div>
            </div>

            {/* Consulting Mode and Chronic Conditions Bar */}
            {!selectedSessionId && (
              <div className="px-5 py-3 bg-emerald-50/50 border-b border-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-20">
                {/* Toggle Pill Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {language === "en" ? "Advice For:" : "सलाह किसके लिए:"}
                  </span>
                  <div className="inline-flex rounded-xl p-0.5 bg-gray-100 border border-gray-200">
                    <button
                      suppressHydrationWarning
                      onClick={() => setConsultingFor("myself")}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                        consultingFor === "myself"
                          ? "bg-white text-emerald-800 shadow-sm border border-emerald-100/50"
                          : "text-gray-500 hover:text-gray-950"
                      }`}
                    >
                      {language === "en" ? "Myself" : "स्वयं"}
                    </button>
                    <button
                      suppressHydrationWarning
                      onClick={() => setConsultingFor("family")}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                        consultingFor === "family"
                          ? "bg-white text-emerald-800 shadow-sm border border-emerald-100/50"
                          : "text-gray-500 hover:text-gray-950"
                      }`}
                    >
                      {language === "en" ? "Family Member" : "परिवार के सदस्य"}
                    </button>
                  </div>
                </div>

                {/* Status indicator */}
                <div className="flex flex-wrap items-center gap-1.5 min-h-[28px]">
                  {consultingFor === "family" ? (
                    <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200/50 px-2.5 py-1 rounded-full flex items-center gap-1 animate-fadeIn">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {language === "en"
                        ? "Family member consultation (Profile alerts paused)"
                        : "परिवार सदस्य परामर्श (प्रोफ़ाइल अलर्ट रोके गए)"}
                    </span>
                  ) : chronicConditions.length > 0 ? (
                    <>
                      <span className="text-xs font-semibold text-emerald-800 mr-1 flex items-center gap-1">
                        {language === "en" ? "Active Conditions:" : "सक्रिय बीमारियां:"}
                      </span>
                      {chronicConditions.map((cond, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white border border-emerald-200 text-emerald-700 shadow-xs capitalize"
                        >
                          {language === "en"
                            ? cond
                            : (CONDITION_TRANSLATIONS[cond.toLowerCase().trim()] || cond)}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-xs text-gray-400 italic">
                      {language === "en"
                        ? "No chronic illnesses recorded in profile"
                        : "प्रोफ़ाइल में कोई पुरानी बीमारी दर्ज नहीं है"}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-5 py-5 space-y-4 chat-scrollbar"
              style={{
                background:
                  "linear-gradient(180deg, rgba(236,253,245,0.4) 0%, rgba(255,255,255,0.4) 100%)",
              }}>
              {selectedSessionId && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-center">
                  <span className="text-xs text-emerald-600/70 bg-emerald-50 border border-emerald-100 px-4 py-1.5 rounded-full font-medium">
                    Viewing past conversation
                  </span>
                </motion.div>
              )}

              <AnimatePresence initial={false}>
                {displayMessages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className={`flex items-end gap-2.5 ${
                      msg.sender === "user" ? "justify-end" : "justify-start"
                    }`}>
                    {msg.sender === "bot" && (
                      <div
                        className="w-8 h-8 rounded-2xl flex items-center justify-center flex-shrink-0 mb-0.5"
                        style={{
                          background:
                            "linear-gradient(135deg, #059669, #10b981)",
                        }}>
                        <Stethoscope className="w-3.5 h-3.5 text-white" />
                      </div>
                    )}
                    <div
                      className={`max-w-[76%] px-4 py-3 text-sm leading-relaxed font-light ${
                        msg.sender === "user"
                          ? "text-white rounded-3xl rounded-br-lg"
                          : "text-gray-700 rounded-3xl rounded-bl-lg border border-emerald-100/80"
                      }`}
                      style={
                        msg.sender === "user"
                          ? {
                              background:
                                "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                              boxShadow: "0 4px 16px rgba(16,185,129,0.25)",
                            }
                          : {
                              background: "rgba(255,255,255,0.95)",
                              boxShadow:
                                "0 2px 12px rgba(16,185,129,0.07), 0 1px 3px rgba(0,0,0,0.04)",
                            }
                      }>
                      {msg.image && (
                        <div className="mb-2.5 max-w-sm rounded-xl overflow-hidden border border-emerald-100">
                          <img src={msg.image} alt="Uploaded attachment" className="w-full max-h-60 object-cover" />
                        </div>
                      )}
                      <div>{renderMessageText(msg)}</div>

                      {msg.injuryData && msg.injuryData.category === "injury_skin" && (
                        <div className="mt-3 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl space-y-3 text-left">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                              First-Aid Assessment
                            </span>
                            {msg.injuryData.severity && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                                msg.injuryData.severity.toLowerCase() === "minor"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : msg.injuryData.severity.toLowerCase() === "moderate"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-red-50 text-red-700 border-red-200 animate-pulse"
                              }`}>
                                {msg.injuryData.severity} Severity
                              </span>
                            )}
                          </div>
                          
                          {msg.injuryData.injury_type && (
                            <p className="text-xs text-gray-805 font-medium capitalize">
                              Detected Type: <span className="text-gray-900 font-semibold">{msg.injuryData.injury_type}</span>
                            </p>
                          )}
                          
                          {msg.injuryData.first_aid_steps && msg.injuryData.first_aid_steps.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">
                                Action Checklist:
                              </span>
                              {msg.injuryData.first_aid_steps.map((step, sIdx) => (
                                <div key={sIdx} className="flex items-start gap-2 text-xs text-gray-700">
                                  <input type="checkbox" className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300" />
                                  <span>{step}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {msg.injuryData.home_remedies && msg.injuryData.home_remedies.length > 0 && (
                            <div className="space-y-1.5 pt-1.5 border-t border-gray-200/50">
                              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">
                                Safe Home Remedies:
                              </span>
                              <ul className="list-disc pl-4 text-xs text-gray-600 space-y-0.5">
                                {msg.injuryData.home_remedies.map((remedy, rIdx) => (
                                  <li key={rIdx}>{remedy}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {msg.ddiAlerts && msg.ddiAlerts.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {msg.ddiAlerts.map((alert, aIdx) => (
                            <div
                              key={aIdx}
                              className={`flex items-start gap-2.5 p-3 rounded-2xl border text-xs leading-normal font-normal ${
                                alert.severity === "HIGH"
                                  ? "bg-red-50 border-red-200 text-red-800"
                                  : "bg-amber-50 border-amber-200 text-amber-800"
                              }`}
                            >
                              <span
                                className={`font-bold text-[9px] uppercase px-1.5 py-0.5 rounded border self-start ${
                                  alert.severity === "HIGH"
                                    ? "bg-white border-red-300 text-red-700"
                                    : "bg-white border-amber-300 text-amber-700"
                                }`}
                              >
                                {alert.severity}
                              </span>
                              <div className="flex-1">
                                <span className="font-semibold capitalize text-gray-900">{alert.drug_a}</span>
                                <span className="text-gray-500 font-light mx-1">and</span>
                                <span className="font-semibold capitalize text-gray-900">{alert.drug_b}</span>
                                <span className="text-gray-600"> have a potential interaction risk.</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.contraindicationAlerts && msg.contraindicationAlerts.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {msg.contraindicationAlerts.map((alert, cIdx) => (
                            <div
                              key={cIdx}
                              className="flex items-start gap-2.5 p-3 rounded-2xl border text-xs leading-normal font-normal bg-red-50 border-red-200 text-red-800"
                            >
                              <span className="font-bold text-[9px] uppercase px-1.5 py-0.5 rounded border self-start bg-white border-red-300 text-red-700">
                                Contraindication
                              </span>
                              <div className="flex-1">
                                <span className="font-semibold capitalize text-gray-900">{alert.medicine}</span>
                                <span className="text-gray-650"> is contraindicated for patients with </span>
                                <span className="font-semibold capitalize text-gray-900">{alert.chronic_condition}</span>.
                                <span className="text-gray-550 font-light block mt-1">
                                  Reason: {alert.contraindication}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.suggestedMedicines && msg.suggestedMedicines.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {msg.suggestedMedicines
                            .filter(med => {
                              // Filter out medicines that have a contraindication alert in this message
                              const hasContra = msg.contraindicationAlerts?.some(
                                alert => alert.medicine.toLowerCase() === med.toLowerCase()
                              );
                              return !hasContra;
                            })
                            .map((med, sIdx) => {
                              const tag = SUGGESTED_TAGS[language] || SUGGESTED_TAGS["en"];
                              const text = SUGGESTED_TEXTS[language] || SUGGESTED_TEXTS["en"];
                              return (
                                <div
                                  key={sIdx}
                                  className="flex items-start gap-2.5 p-3 rounded-2xl border text-xs leading-normal font-normal bg-emerald-50 border-emerald-200 text-emerald-800"
                                  style={{
                                    animation: "fadeIn 0.3s ease-out"
                                  }}
                                >
                                  <span className="font-bold text-[9px] uppercase px-1.5 py-0.5 rounded border self-start bg-white border-emerald-300 text-emerald-700">
                                    {tag}
                                  </span>
                                  <div className="flex-1">
                                    <span className="font-semibold capitalize text-gray-900">{med}</span>{" "}
                                    <span className="text-gray-650">{text}</span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                    {msg.sender === "user" && (
                      <div className="w-8 h-8 rounded-2xl flex-shrink-0 mb-0.5 flex items-center justify-center bg-emerald-100 border border-emerald-200">
                        <span className="text-emerald-700 text-xs font-bold">
                          {isLoggedIn && userName
                            ? userName[0].toUpperCase()
                            : "U"}
                        </span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {loading && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-end gap-2.5">
                  <div
                    className="w-8 h-8 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "linear-gradient(135deg, #059669, #10b981)",
                    }}>
                    <Stethoscope className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div
                    className="bg-white border border-emerald-100 rounded-3xl rounded-bl-lg px-5 py-3.5 flex gap-1.5 items-center"
                    style={{ boxShadow: "0 2px 12px rgba(16,185,129,0.07)" }}>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce"
                        style={{ animationDelay: `${i * 0.16}s` }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* ── INPUT AREA ── */}
            {!selectedSessionId && (
              <div className="px-4 py-4 bg-white/80 border-t border-emerald-50">
                {imagePreview && (
                  <div className="relative mb-3 flex items-center gap-3 p-2 bg-emerald-50/50 border border-emerald-100 rounded-xl max-w-max" style={{ animation: "fadeIn 0.2s ease-out" }}>
                    <img src={imagePreview} alt="Upload preview" className="w-12 h-12 object-cover rounded-lg border border-emerald-250" />
                    <div className="text-left pr-6">
                      <p className="text-[10px] text-gray-400">Selected image</p>
                      <p className="text-xs font-semibold text-gray-700 truncate max-w-[150px]">{selectedFile?.name}</p>
                    </div>
                    <button 
                      suppressHydrationWarning
                      onClick={removeSelectedImage}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-md transition-all text-xs font-bold"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <div
                  className="flex items-center gap-2 rounded-2xl px-3 py-2.5 border border-emerald-200/60 transition-all focus-within:border-emerald-400 focus-within:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]"
                  style={{ background: "rgba(236,253,245,0.5)" }}>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    suppressHydrationWarning
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || transcribing}
                    title="Upload image"
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700 transition-all"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button
                    onClick={startListening}
                    disabled={loading || transcribing}
                    suppressHydrationWarning
                    title={listening ? "Stop recording" : transcribing ? "Transcribing..." : "Start recording"}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
                      listening
                        ? "bg-red-500 text-white listening-ring"
                        : transcribing
                        ? "bg-amber-100 text-amber-600 cursor-not-allowed"
                        : "text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700"
                    }`}>
                    {listening ? (
                      <MicOff className="w-4 h-4" />
                    ) : transcribing ? (
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    type="text"
                    value={input}
                    placeholder={transcribing ? "Transcribing your voice..." : PLACEHOLDERS[language]}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyPress}
                    disabled={loading || transcribing}
                    suppressHydrationWarning
                    className={`flex-1 bg-transparent text-sm outline-none font-light min-w-0 ${
                      transcribing ? "text-amber-500 placeholder-amber-400 italic" : "text-gray-700 placeholder-gray-400"
                    }`}
                  />
                  <motion.button
                    suppressHydrationWarning
                    onClick={handleSend}
                    disabled={loading || (!input.trim() && !selectedFile)}
                    whileTap={(input.trim() || selectedFile) && !loading ? { scale: 0.9 } : {}}
                    className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center transition-all ${
                      (input.trim() || selectedFile) && !loading
                        ? "text-white shadow-lg shadow-emerald-200/60 hover:opacity-90"
                        : "bg-gray-100 text-gray-300 cursor-not-allowed"
                    }`}
                    style={
                      (input.trim() || selectedFile) && !loading
                        ? {
                            background:
                              "linear-gradient(135deg, #059669, #10b981)",
                          }
                        : {}
                    }>
                    <Send className="w-4 h-4" />
                  </motion.button>
                </div>
                <p className="text-center text-xs text-gray-400 mt-2.5 font-light tracking-wide">
                  For medical emergencies, please call{" "}
                  <span className="font-semibold text-red-400">112</span>{" "}
                  immediately
                </p>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-white">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center animate-pulse">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <p className="text-sm text-gray-400 font-light">
              Loading Health Assistant...
            </p>
          </div>
        </div>
      }>
      <ChatAssistantPage />
    </Suspense>
  );
}
