"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Send, Bot } from "lucide-react";

export default function ChatAssistantPage() {
  // ------------------------
  // State
  // ------------------------
  const [messages, setMessages] = useState<
    { sender: "user" | "bot"; text: string }[]
  >([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ------------------------
  // Effects
  // ------------------------
  useEffect(() => {
    const greeting =
      "👋 Hello! I'm your healthcare assistant. How can I help you today?";
    setMessages([{ sender: "bot", text: greeting }]);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ------------------------
  // Handle Send
  // ------------------------
  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = { sender: "user", text: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    const userInput = input.trim();
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("http://localhost:8000/chat", {
        // your FastAPI backend
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          message: userInput,
          language: "en",
        }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const data = await res.json();

      const botReply = {
        sender: "bot",
        text: data.reply || "⚠ Something went wrong. Please try again later.",
      };

      setMessages((prev) => [...prev, botReply]);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: "⚠ Something went wrong. Please try again later.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading && input.trim()) {
      handleSend();
    }
  };

  return (
    <section className="relative min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white py-8 px-4 sm:px-6 flex flex-col items-center overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="w-full max-w-3xl bg-white rounded-3xl shadow-xl border border-emerald-100 p-4 sm:p-6 flex flex-col h-[85vh] relative z-10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Bot className="h-6 w-6 text-emerald-600" />
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-800">
            Health Chat Assistant
          </h1>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto mb-4 space-y-4 px-1 scrollbar-thin scrollbar-thumb-emerald-200 scrollbar-track-gray-100">
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${
                msg.sender === "user" ? "justify-end" : "justify-start"
              }`}>
              <div
                className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm sm:text-base shadow-sm ${
                  msg.sender === "user"
                    ? "bg-emerald-600 text-white rounded-br-none"
                    : "bg-gray-100 text-gray-800 rounded-bl-none border border-gray-200"
                }`}>
                <p className="break-words">{msg.text}</p>
              </div>
            </motion.div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 px-4 py-3 rounded-2xl text-sm text-gray-600 animate-pulse border border-gray-200">
                Typing...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input + Send Button */}
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={input}
            placeholder="Type your message..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            disabled={loading}
            className="flex-1 border border-gray-300 rounded-full px-4 py-3 text-black placeholder:text-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent focus:outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:bg-gray-400 disabled:from-gray-400 disabled:to-gray-400 text-white p-3 transition-all duration-200 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
            title="Send message">
            <Send className="h-5 w-5" />
          </button>
        </div>
      </motion.div>
    </section>
  );
}
