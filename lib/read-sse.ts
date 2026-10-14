// Reads a server-sent-events response body and hands each event to `onEvent`,
// the same framing the generate-stream route uses (event: name / data: json).
// Client-safe, no dependencies.
export async function readSse(
  res: Response,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      let event = "message";
      let data = "";
      for (const line of message.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      if (!data) continue;
      onEvent(event, JSON.parse(data) as Record<string, unknown>);
    }
  }
}
