"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, ShieldAlert } from "lucide-react";

const LANG_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  pahadi: "Pahadi",
  garhwali: "Garhwali",
};

type Message = { sender: "user" | "bot"; text: string };
type ReportData = {
  messages: Message[];
  language: string;
  timestamp: string;
  user?: { name?: string; email?: string };
};

const SYMPTOM_KEYWORDS = [
  "fever",
  "pain",
  "cough",
  "vomiting",
  "breathing",
  "chills",
  "seizure",
  "confusion",
  "drowsiness",
  "jaundice",
  "yellowing",
  "chest",
  "swelling",
  "fatigue",
  "dizzy",
  "rash",
  "diarrhea",
  "weakness",
  "headache",
  "nausea",
  "dark circle",
  "lazy",
  "deficiency",
  "iron",
  "vitamin",
  "sleep",
  "stress",
  "dehydration",
  "discharge",
  "bleeding",
  "burn",
  "itch",
  "sore",
  "sweat",
  "shiver",
  "cramp",
  "bleed",
  "memory loss",
  "memory",
  "disoriented",
  "forgetful",
  "recognition",
  "neurological",
  "ताव",
  "बुखार",
  "दर्द",
  "दुखाण",
  "दुखणू",
  "खुजली",
  "खांसी",
  "कासणु",
  "उल्टी",
  "ओकाण",
  "थकाण",
  "चक्कर",
];

const DISEASE_LIST = [
  "Alzheimer's disease",
  "Alzheimer",
  "alzheimer",
  "Dementia",
  "dementia",
  "Malaria",
  "malaria",
  "Dengue",
  "dengue",
  "Typhoid",
  "typhoid",
  "Meningitis",
  "meningitis",
  "Sepsis",
  "sepsis",
  "Encephalitis",
  "encephalitis",
  "Pneumonia",
  "pneumonia",
  "COVID",
  "covid",
  "Influenza",
  "influenza",
  "Hepatitis",
  "hepatitis",
  "Jaundice",
  "jaundice",
  "Tuberculosis",
  "tuberculosis",
  "Chikungunya",
  "chikungunya",
  "Asthma",
  "asthma",
  "UTI",
  "uti",
  "Gastroenteritis",
  "gastroenteritis",
  "Migraine",
  "migraine",
  "Liver Failure",
  "liver failure",
  "Cerebral Malaria",
  "cerebral malaria",
  "Viral Fever",
  "viral fever",
  "Food Poisoning",
  "food poisoning",
  "Anemia",
  "anemia",
  "Iron Deficiency",
  "iron deficiency",
  "Vitamin B12 Deficiency",
  "vitamin b12 deficiency",
  "Vitamin D Deficiency",
  "vitamin d deficiency",
  "Depression",
  "depression",
  "Neurological disorder",
  "neurological disorder",
  "Parkinson",
  "parkinson",
  "Stroke",
  "stroke",
  "Hypertension",
  "hypertension",
  "Diabetes",
  "diabetes",
];

const EMERGENCY_PHRASES = [
  "go to hospital immediately",
  "seek immediate medical attention",
  "call emergency",
  "call 112",
  "life-threatening",
  "emergency room",
  "difficulty breathing",
  "cannot breathe",
  "chest pain",
  "seizures",
  "unconscious",
  "severe chest",
];

function extractSymptoms(messages: Message[]): string[] {
  const found = new Set<string>();
  messages
    .filter((m) => m.sender === "user")
    .forEach((m) => {
      const lower = m.text.toLowerCase();
      SYMPTOM_KEYWORDS.forEach((kw) => {
        if (lower.includes(kw.toLowerCase())) found.add(kw);
      });
    });
  return Array.from(found);
}

function extractDiseases(messages: Message[]): string[] {
  const found = new Map<string, string>();
  messages
    .filter((m) => m.sender === "bot")
    .slice(1)
    .forEach((m) => {
      const lower = m.text.toLowerCase();
      DISEASE_LIST.forEach((d) => {
        if (lower.includes(d.toLowerCase())) {
          const key = d.toLowerCase().replace("'s", "").trim();
          if (!found.has(key)) {
            found.set(key, d.charAt(0).toUpperCase() + d.slice(1));
          }
        }
      });
    });
  return Array.from(found.values());
}

function isEmergency(messages: Message[]): boolean {
  return messages
    .filter((m) => m.sender === "bot")
    .some((m) =>
      EMERGENCY_PHRASES.some((phrase) =>
        m.text.toLowerCase().includes(phrase.toLowerCase()),
      ),
    );
}

function extractKeyAdvice(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const important = sentences.filter((s) => {
    const l = s.toLowerCase();
    return (
      DISEASE_LIST.some((d) => l.includes(d.toLowerCase())) ||
      l.includes("recommend") ||
      l.includes("suggest") ||
      l.includes("possible") ||
      l.includes("could be") ||
      l.includes("may be") ||
      l.includes("might") ||
      l.includes("likely") ||
      l.includes("indicates") ||
      l.includes("consistent with") ||
      l.includes("associated with") ||
      l.includes("deficiency") ||
      l.includes("doctor") ||
      l.includes("test") ||
      l.includes("rest") ||
      l.includes("water") ||
      l.includes("avoid") ||
      l.includes("immediate") ||
      l.includes("emergency") ||
      l.includes("neurological") ||
      l.includes("consult")
    );
  });
  return important.length > 0 ? important : sentences.slice(0, 3);
}

function getBestBotMessage(messages: Message[]): string {
  const botMsgs = messages.filter((m) => m.sender === "bot").slice(1);
  if (botMsgs.length === 0) return "";
  return botMsgs.sort((a, b) => b.text.length - a.text.length)[0].text;
}

function getChiefComplaint(messages: Message[]): string {
  const userMsgs = messages.filter((m) => m.sender === "user");
  if (userMsgs.length === 0) return "—";
  return userMsgs[0].text;
}

// Get initials from name or email
function getInitials(name?: string, email?: string): string {
  if (name && name.trim()) {
    return name
      .trim()
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return "?";
}

// Generate report ID from timestamp
function generateReportId(timestamp: string): string {
  const d = new Date(timestamp);
  return `UHC-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReportPage() {
  const router = useRouter();
  const [reportData, setReportData] = useState<ReportData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("chatReportData");
    if (raw) setReportData(JSON.parse(raw));
  }, []);

  if (!reportData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <p className="text-gray-500">No report data found.</p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm">
            Go back to chat
          </button>
        </div>
      </div>
    );
  }

  const symptoms = extractSymptoms(reportData.messages);
  const diseases = extractDiseases(reportData.messages);
  const emergency = isEmergency(reportData.messages);
  const bestBot = getBestBotMessage(reportData.messages);
  const keyAdvice = bestBot ? extractKeyAdvice(bestBot) : [];
  const complaint = getChiefComplaint(reportData.messages);
  const date = new Date(reportData.timestamp);

  // Real user from session
  const userName = reportData.user?.name || "";
  const userEmail = reportData.user?.email || "";
  const initials = getInitials(userName, userEmail);
  const reportId = generateReportId(reportData.timestamp);

  const formattedDate = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0; }
          .print-root {
            box-shadow: none !important;
            border-radius: 0 !important;
            max-width: 100% !important;
            margin: 0 !important;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <section className="min-h-screen bg-gray-100 py-8 px-4">
        {/* Toolbar */}
        <div className="max-w-3xl mx-auto flex items-center justify-between mb-5 no-print">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to Chat
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl shadow-md transition-all">
            <Printer className="w-4 h-4" />
            Print / Save PDF
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="print-root max-w-3xl mx-auto bg-white rounded-2xl overflow-hidden shadow-lg">
          {/* ══ HEADER ══ */}
          <div className="bg-emerald-700 px-8 py-5 flex items-center justify-between">
            <div>
              <h1 className="text-white text-lg font-bold tracking-wide">
                AI HEALTH CONSULTATION REPORT
              </h1>
              <p className="text-emerald-200 text-xs mt-0.5">
                Powered by AI Healthcare Assistant · Uttarakhand
              </p>
            </div>
            {emergency && (
              <span className="bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg tracking-wider flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                EMERGENCY
              </span>
            )}
          </div>

          {/* ══ META ROW ══ */}
          <div className="bg-emerald-50 border-b border-emerald-200 px-8 py-2.5 flex flex-wrap gap-x-8 gap-y-1 text-xs text-gray-600">
            <span>
              <span className="font-semibold text-gray-700">Report ID:</span>{" "}
              {reportId}
            </span>
            <span>
              <span className="font-semibold text-gray-700">Date:</span>{" "}
              {formattedDate}
            </span>
            <span>
              <span className="font-semibold text-gray-700">Time:</span>{" "}
              {formattedTime}
            </span>
            <span>
              <span className="font-semibold text-gray-700">Language:</span>{" "}
              {LANG_LABELS[reportData.language] || reportData.language}
            </span>
          </div>

          <div className="px-8 py-6 space-y-6">
            {/* ══ EMERGENCY BANNER ══ */}
            {emergency && (
              <div className="bg-red-50 border-l-4 border-red-500 px-4 py-3 rounded-r-xl">
                <p className="text-red-700 font-bold text-sm">
                  ⚠ EMERGENCY — Seek immediate medical attention
                </p>
                <p className="text-red-600 text-xs mt-0.5">
                  Symptoms detected may indicate a life-threatening condition.
                  Call <strong>112</strong> or go to the nearest emergency room
                  now.
                </p>
              </div>
            )}

            {/* ══ SECTION 1 — PATIENT INFO ══ */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-1 bg-emerald-600 rounded-full" />
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Section 1 — Patient Information
                </h2>
              </div>

              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                {/* Avatar with initials */}
                <div className="w-14 h-14 rounded-2xl bg-gray-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xl font-bold">
                    {initials}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  {userName && (
                    <p className="text-gray-900 font-semibold text-sm">
                      {userName}
                    </p>
                  )}
                  {userEmail && (
                    <p className="text-gray-500 text-xs mt-0.5">{userEmail}</p>
                  )}
                  {!userName && !userEmail && (
                    <p className="text-gray-400 text-sm italic">Guest user</p>
                  )}
                  <p className="text-gray-400 text-xs mt-1">
                    AI Symptom Check · Uttarakhand
                  </p>
                </div>
              </div>
            </div>

            {/* ══ SECTION 2 ══ */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-1 bg-emerald-600 rounded-full" />
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Section 2 — Chief Complaint
                </h2>
              </div>
              <div className="border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 text-sm text-gray-700 leading-relaxed">
                {complaint}
              </div>
            </div>

            {/* ══ SECTION 3 ══ */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-1 bg-orange-500 rounded-full" />
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Section 3 — Symptoms Identified
                </h2>
              </div>
              {symptoms.length > 0 ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {symptoms.map((s, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 px-4 py-2.5 ${
                        i % 2 === 0 ? "bg-white" : "bg-gray-50"
                      } border-b border-gray-100 last:border-0`}>
                      <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                      <span className="text-gray-700 text-sm capitalize">
                        {s}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm italic px-1">
                  No specific symptoms extracted.
                </p>
              )}
            </div>

            {/* ══ SECTION 4 ══ */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-1 bg-purple-500 rounded-full" />
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Section 4 — Possible Conditions (AI Prediction)
                </h2>
              </div>
              {diseases.length > 0 ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {diseases.map((d, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-4 py-2.5 ${
                        i % 2 === 0 ? "bg-white" : "bg-gray-50"
                      } border-b border-gray-100 last:border-0`}>
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            emergency ? "bg-red-400" : "bg-purple-400"
                          }`}
                        />
                        <span className="text-gray-800 text-sm font-semibold">
                          {d}
                        </span>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          emergency
                            ? "bg-red-50 text-red-600"
                            : "bg-purple-50 text-purple-600"
                        }`}>
                        AI Prediction
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm italic px-1">
                  No specific conditions predicted in this conversation.
                </p>
              )}
            </div>

            {/* ══ SECTION 5 ══ */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-1 bg-emerald-600 rounded-full" />
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Section 5 — AI Recommendations
                </h2>
              </div>
              {keyAdvice.length > 0 ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {keyAdvice.map((point, i) => (
                    <div
                      key={i}
                      className={`flex gap-3 px-4 py-2.5 ${
                        i % 2 === 0 ? "bg-white" : "bg-gray-50"
                      } border-b border-gray-100 last:border-0`}>
                      <span className="text-emerald-600 font-bold text-xs pt-0.5 flex-shrink-0">
                        {i + 1}.
                      </span>
                      <span className="text-gray-700 text-sm leading-relaxed">
                        {point.trim()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm italic px-1">
                  No recommendations available.
                </p>
              )}
            </div>

            {/* ══ DISCLAIMER ══ */}
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-5 py-4">
              <p className="text-amber-800 text-xs font-bold uppercase tracking-wide mb-2">
                ⚠ Important Disclaimer
              </p>
              <p className="text-amber-700 text-xs leading-relaxed">
                This report has been{" "}
                <strong>generated by Artificial Intelligence</strong> and is
                intended for informational purposes only. It is{" "}
                <strong>not a medical diagnosis</strong> and should not be used
                as a substitute for professional medical advice. AI predictions
                may be incomplete or incorrect.{" "}
                <strong>You must visit a qualified doctor</strong> for a proper
                physical examination and confirmed diagnosis before taking any
                medication or treatment.
              </p>
            </div>

            {/* ══ FOOTER ══ */}
            <div className="flex items-end justify-between pt-2 border-t border-dashed border-gray-200">
              <div>
                <p className="text-gray-400 text-xs">
                  Generated by AI Health Assistant
                </p>
                <p className="text-gray-300 text-xs">
                  {formattedDate} · {formattedTime}
                </p>
              </div>
              <p className="text-gray-300 text-xs text-right">
                This report does not replace a doctor's consultation
              </p>
            </div>
          </div>
        </motion.div>
      </section>
    </>
  );
}
