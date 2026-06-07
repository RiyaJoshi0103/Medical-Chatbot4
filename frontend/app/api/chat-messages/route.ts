import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { sessionId, sender, message } = await req.json();
    await pool.query(
      `INSERT INTO "ChatMessage" (id, "sessionId", sender, message, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [sessionId, sender, message],
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("chat-messages POST error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");
    if (!email) return NextResponse.json({ sessions: [] });

    const result = await pool.query(
      `SELECT s.id, s."startedAt"::timestamptz as started_at, s.language,
              COUNT(m.id)::int as message_count
       FROM "ChatSession" s
       LEFT JOIN "ChatMessage" m ON m."sessionId" = s.id
       WHERE s."userEmail" = $1
       GROUP BY s.id, s."startedAt", s.language
       HAVING COUNT(m.id) > 0
       ORDER BY s."startedAt" DESC`,
      [email],
    );
    return NextResponse.json({ sessions: result.rows });
  } catch (err: any) {
    console.error("chat-messages GET error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
