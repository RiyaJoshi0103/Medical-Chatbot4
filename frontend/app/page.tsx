"use client";

import React, { useEffect, useState, useRef } from "react";
import axios from "axios";

interface Message {
  sender: "user" | "bot";
  text: string;
}

// Minimal fix to satisfy TypeScript for process.env
declare var process: {
  env: {
    NEXT_PUBLIC_BACKEND_URL: string;
  };
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Use live backend URL directly
  const BACKEND_URL = "https://mchat-backend-isxf.onrender.com";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 🩺 Start the conversation automatically
  useEffect(() => {
    const startChat = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/start`);
        setSessionId(res.data.session_id);
        setMessages([{ sender: "bot", text: res.data.reply }]);
      } catch (err) {
        console.error("Error starting chat:", err);
        setMessages([
          {
            sender: "bot",
            text: "⚠️ Could not connect to server. Try again later.",
          },
        ]);
      }
    };
    startChat();
  }, [BACKEND_URL]);

  const sendMessage = async () => {
    if (!input.trim() || !sessionId) return;
    const userMessage = input.trim();

    setMessages((prev) => [...prev, { sender: "user", text: userMessage }]);
    setInput("");
    setLoading(true);

    try {
      const res = await axios.post(`${BACKEND_URL}/chat`, {
        message: userMessage,
        session_id: sessionId,
      });

      const botReply = res.data.reply || "I'm here to help.";
      setMessages((prev) => [...prev, { sender: "bot", text: botReply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: "⚠️ Sorry, I’m having trouble connecting right now.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !loading) sendMessage();
  };

  return (
    <div className="flex flex-col h-screen bg-emerald-50 text-gray-800">
      {/* Header */}
      <header className="bg-white border-b border-emerald-200 p-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
          <h1 className="text-2xl font-semibold text-emerald-600 tracking-tight">
            HealthCare<span className="text-emerald-500">+</span>
          </h1>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-emerald-600 border border-emerald-400 px-3 py-1 rounded-full hover:bg-emerald-100 transition">
          ↻ New Chat
        </button>
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${
              msg.sender === "user" ? "justify-end" : "justify-start"
            }`}>
            <div
              className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                msg.sender === "user"
                  ? "bg-emerald-600 text-white rounded-br-none"
                  : "bg-white border border-emerald-100 text-gray-800 rounded-bl-none"
              }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-gray-400 italic text-sm animate-pulse">
            Assistant is typing...
          </div>
        )}
        <div ref={chatEndRef}></div>
      </main>

      {/* Input section */}
      <footer className="p-4 bg-white border-t border-gray-200 flex items-center gap-2">
        <input
          type="text"
          placeholder="Type your message..."
          className="flex-1 border border-emerald-300 rounded-full px-4 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-emerald-50"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          className="bg-emerald-600 text-white px-5 py-2 rounded-full hover:bg-emerald-700 transition disabled:opacity-50">
          Send
        </button>
      </footer>
    </div>
  );
}
