import { NextResponse } from "next/server";
import { runDay } from "jobs/run";

export async function POST(request: Request) {
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Zabranjeno" }, { status: 401 });
  }
  await runDay(new Date());
  return NextResponse.json({ ok: true });
}
