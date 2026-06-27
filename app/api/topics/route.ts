import { NextRequest, NextResponse } from "next/server";
import { createTopic } from "@/lib/db/queries";
import type { TopicFormData } from "@/lib/db/types";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { clusterId: string; data: TopicFormData };

    if (!body.clusterId || !body.data?.title?.trim()) {
      return NextResponse.json(
        { error: "clusterId and title are required." },
        { status: 400 },
      );
    }

    const topic = await createTopic(body.clusterId, body.data);
    return NextResponse.json(topic, { status: 201 });
  } catch (err) {
    console.error("topic create error", err);
    return NextResponse.json({ error: "Failed to create topic." }, { status: 500 });
  }
}
