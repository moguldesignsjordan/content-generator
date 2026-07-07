import { NextRequest, NextResponse } from "next/server";
import { updateFunnelDefinition } from "@/lib/db/queries";
import { logError } from "@/lib/log";

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      strategyId: string;
      funnelDefinition: Record<string, { cta_type: string }>;
    };

    if (!body.strategyId) {
      return NextResponse.json({ error: "strategyId is required." }, { status: 400 });
    }

    const stages = ["awareness", "consideration", "decision"];
    for (const stage of stages) {
      if (!body.funnelDefinition?.[stage]?.cta_type?.trim()) {
        return NextResponse.json(
          { error: `${stage} cta_type is required.` },
          { status: 400 },
        );
      }
    }

    await updateFunnelDefinition(body.strategyId, body.funnelDefinition);
    return NextResponse.json({ saved: true });
  } catch (err) {
    logError("api:/api/settings/funnel", err);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}
