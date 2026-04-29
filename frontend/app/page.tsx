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
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

type Message = { sender: "user" | "bot"; text: string };
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
};

const PLACEHOLDERS: Record<string, string> = {
  en: "Describe your symptoms...",
  hi: "अपने लक्षण बताएं...",
  pahadi: "अपणि तकलीफ बताओ...",
};

const LANG_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  pahadi: "Pahadi",
};

// ── Outside component — plain JS variable, no closure issues ──
let globalLanguage = "en";

function ChatAssistantPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const userName = searchParams.get("name") || "";
  const userEmail = searchParams.get("email") || "";
  const isLoggedIn = !!userEmail;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
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

  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const dbSessionIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ sender: "bot", text: GREETINGS["en"] }]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!sidebarOpen || !isLoggedIn) return;
    setLoadingSessions(true);
    fetch(`/api/chat-messages?email=${encodeURIComponent(userEmail)}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions || []);
        setLoadingSessions(false);
      });
  }, [sidebarOpen]);

  const loadSessionMessages = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    const res = await fetch(`/api/chat-history?sessionId=${sessionId}`);
    const data = await res.json();
    setSessionMessages(
      (data.messages || []).map((m: any) => ({
        sender: m.sender,
        text: m.message,
      })),
    );
  };

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    globalLanguage = newLang; // ← update global immediately
    setMessages((prev) => {
      const conversationStarted = prev.some((m) => m.sender === "user");
      if (conversationStarted) return prev;
      return [{ sender: "bot", text: GREETINGS[newLang] }];
    });
  };

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

  const saveMessage = async (sender: "user" | "bot", message: string) => {
    if (!isLoggedIn) return;
    if (!dbSessionIdRef.current) {
      try {
        const res = await fetch("/api/chat-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userEmail, userName, language }),
        });
        const d = await res.json();
        dbSessionIdRef.current = d.sessionId;
      } catch (e) {
        console.error("Session create error:", e);
        return;
      }
    }
    await fetch("/api/chat-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: dbSessionIdRef.current,
        sender,
        message,
      }),
    }).catch(console.error);
  };

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
      const capturedLang = globalLanguage; // ← always correct, no closure issue

      console.log("🎤 Mic started, language =", capturedLang);

      (window as any)._mediaRecorder = mediaRecorder;
      setListening(true);

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("file", audioBlob, "audio.webm");
        // removed: formData.append("language", ...) — FastAPI ignores form fields for query params

        console.log("🎤 Sending to /transcribe with language:", capturedLang);

        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_BACKEND_URL}/transcribe?language=${capturedLang}`,
            { method: "POST", body: formData },
          );
          const data = await res.json();
          console.log("✅ Transcription received:", data.text);
          if (data.text) {
            setInput(data.text);
            setLastInputWasVoice(true);
          }
        } catch (err) {
          console.error("Transcription error:", err);
        } finally {
          setListening(false);
        }
      };

      mediaRecorder.start();
    } catch (err) {
      alert("Microphone access denied. Please allow mic access and try again.");
      setListening(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage: Message = { sender: "user", text: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    const userInput = input.trim();
    setInput("");
    setLoading(true);
    await saveMessage("user", userInput);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          message: userInput,
          language: globalLanguage, // ← use global here too
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const botReply: Message = {
        sender: "bot",
        text: data.reply || "Something went wrong. Please try again.",
      };
      setMessages((prev) => [...prev, botReply]);
      speakResponse(botReply.text);
      await saveMessage("bot", botReply.text);
    } catch {
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
    if (e.key === "Enter" && !loading && input.trim()) {
      setLastInputWasVoice(false);
      handleSend();
    }
  };

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

  const startNewChat = () => {
    setSelectedSessionId(null);
    setSessionMessages([]);
    setSidebarOpen(false);
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
                    onClick={() => setSidebarOpen(false)}
                    className="p-2 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="px-4 pb-3">
                <button
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
                        key={s.id}
                        onClick={() => {
                          loadSessionMessages(s.id);
                          setSidebarOpen(false);
                        }}
                        className={`w-full text-left px-3 py-3 rounded-2xl transition-all group ${selectedSessionId === s.id ? "bg-white/20 border border-white/25" : "hover:bg-white/10 border border-transparent"}`}>
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
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="bg-transparent text-gray-600 text-xs font-medium outline-none cursor-pointer">
                  <option value="en">English</option>
                  <option value="hi">हिंदी</option>
                  <option value="pahadi">पहाड़ी</option>
                </select>
              </div>
            )}
            <button
              onClick={toggleMute}
              title={muted ? "Unmute" : "Mute"}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${muted ? "bg-red-50 border-red-200 text-red-500" : "border-emerald-200/60 text-gray-500 hover:border-emerald-400 hover:text-emerald-700"}`}
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
                onClick={handleOpenReport}
                disabled={messages.length <= 1}
                title="Generate Report"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${messages.length > 1 ? "border-emerald-300 text-emerald-700 hover:border-emerald-500" : "border-gray-200 text-gray-300 cursor-not-allowed"}`}
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
                    className={`flex items-end gap-2.5 ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
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
                      className={`max-w-[76%] px-4 py-3 text-sm leading-relaxed font-light ${msg.sender === "user" ? "text-white rounded-3xl rounded-br-lg" : "text-gray-700 rounded-3xl rounded-bl-lg border border-emerald-100/80"}`}
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
                      {msg.text}
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
                <div
                  className="flex items-center gap-2 rounded-2xl px-3 py-2.5 border border-emerald-200/60 transition-all focus-within:border-emerald-400 focus-within:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]"
                  style={{ background: "rgba(236,253,245,0.5)" }}>
                  <button
                    onClick={startListening}
                    disabled={loading}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${listening ? "bg-red-500 text-white listening-ring" : "text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700"}`}>
                    {listening ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    type="text"
                    value={input}
                    placeholder={PLACEHOLDERS[language]}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyPress}
                    disabled={loading}
                    className="flex-1 bg-transparent text-gray-700 text-sm outline-none placeholder-gray-400 font-light min-w-0"
                  />
                  <motion.button
                    onClick={handleSend}
                    disabled={loading || !input.trim()}
                    whileTap={input.trim() && !loading ? { scale: 0.9 } : {}}
                    className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center transition-all ${input.trim() && !loading ? "text-white shadow-lg shadow-emerald-200/60 hover:opacity-90" : "bg-gray-100 text-gray-300 cursor-not-allowed"}`}
                    style={
                      input.trim() && !loading
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
