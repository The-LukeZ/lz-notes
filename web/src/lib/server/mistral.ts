// Note generation via Mistral chat completions (PLAN §1). One synchronous call,
// fast enough that it doesn't need the queue. Transcription (the long job) lives
// in the consumer worker, not here.

const CHAT_COMPLETIONS_URL = "https://api.mistral.ai/v1/chat/completions";
const NOTES_MODEL = "mistral-large-latest";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function generateNotes(
  apiKey: string,
  systemPrompt: string,
  transcript: string,
  instructions?: string | null
): Promise<string> {
  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: NOTES_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...[
          instructions
            ? {
                role: "system",
                content: `Additional context/clarifications - use these to resolve ambiguity or correct mistranscriptions, but don't invent facts beyond them:\n${instructions}`,
              }
            : null,
        ].filter(Boolean),
        { role: "user", content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mistral chat completion failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Mistral chat completion returned no content: ${JSON.stringify(data)}`);
  }
  return content;
}
