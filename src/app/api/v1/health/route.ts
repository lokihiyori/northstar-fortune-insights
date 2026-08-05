import { NextResponse } from "next/server";

// Liveness must reflect the current process, never a cached render.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    data: {
      status: "ok",
      service: "northstar",
      phase: 6,
      timestamp: new Date().toISOString(),
    },
  });
}
