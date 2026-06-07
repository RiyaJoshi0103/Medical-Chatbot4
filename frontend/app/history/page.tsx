"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, MessageSquare, Clock, Globe } from "lucide-react";

type Session = {
  id: string;
  started_at: string;
  language: string;
  message_count: number;
};

type Message = {
  sender: string;
  message: string;
  created_at: string;
};

const LANG_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  pahadi: "Pahadi",
  garhwali: "Garhwali",
};

function HistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) return;
    fetch(`/api/chat-messages?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch chat sessions:", err);
        setLoading(false);
      });
  }, [email]);

  const loadSession = async (sessionId: string) => {
    setSelectedSession(sessionId);
    try {
      const res = await fetch(`/api/chat-history?sessionId=${sessionId}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error("Failed to load session messages:", err);
      setMessages([]);
    }
  };

  if (!email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50">
        <div className="text-center space-y-4">
          <p className="text-gray-500">Please log in to view chat history.</p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm">
            Go to Chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <h1 className="text-xl font-semibold text-gray-800">Chat History</h1>
          <span className="text-xs text-gray-400">{email}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Sessions list */}
          <div className="md:col-span-1 space-y-2">
            {loading ? (
              <p className="text-gray-400 text-sm">Loading...</p>
            ) : sessions.length === 0 ? (
              <p className="text-gray-400 text-sm">No chat history yet.</p>
            ) : (
              sessions.map((s) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => loadSession(s.id)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    selectedSession === s.id
                      ? "bg-emerald-50 border-emerald-300"
                      : "bg-white border-gray-100 hover:border-emerald-200"
                  }`}
                  style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs font-medium text-gray-700">
                      {s.message_count} messages
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <span className="text-xs text-gray-400">
                      {new Date(s.started_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <Globe className="w-3 h-3 text-gray-400" />
                    <span className="text-xs text-gray-400">
                      {LANG_LABELS[s.language] || s.language}
                    </span>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          {/* Messages panel */}
          <div
            className="md:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden"
            style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            {!selectedSession ? (
              <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
                Select a session to view messages
              </div>
            ) : (
              <div className="flex flex-col h-[600px]">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-xs text-gray-500 font-medium">
                    Conversation
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] px-4 py-2.5 text-sm rounded-2xl ${
                          m.sender === "user"
                            ? "bg-emerald-500 text-white rounded-br-md"
                            : "bg-gray-100 text-gray-700 rounded-bl-md"
                        }`}>
                        {m.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Loading...
        </div>
      }>
      <HistoryPage />
    </Suspense>
  );
}
