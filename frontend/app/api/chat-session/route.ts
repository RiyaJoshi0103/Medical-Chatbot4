import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { userEmail, userName, language } = await req.json();
    const result = await pool.query(
      `INSERT INTO "ChatSession" (id, "userEmail", "userName", language, "startedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING id`,
      [userEmail, userName || "", language || "en"],
    );
    return NextResponse.json({ sessionId: result.rows[0].id });
  } catch (err: any) {
    console.error("chat-session error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
