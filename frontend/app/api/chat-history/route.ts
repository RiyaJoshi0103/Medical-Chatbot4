import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ messages: [] });

    const result = await pool.query(
      `SELECT sender, message, "createdAt" as created_at
       FROM "ChatMessage"
       WHERE "sessionId" = $1
       ORDER BY "createdAt" ASC`,
      [sessionId],
    );
    return NextResponse.json({ messages: result.rows });
  } catch (err: any) {
    console.error("chat-history error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
