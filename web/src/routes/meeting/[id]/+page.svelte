<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";

  let { data } = $props();

  const meeting = $derived(data.meeting);

  // Unique diarization labels in first-seen order, with the current name (if any)
  // prefilled into the editable mapping.
  let speakerNames = $state<Record<string, string>>({});
  $effect(() => {
    const next: Record<string, string> = {};
    for (const s of data.segments) {
      if (!(s.speaker_label in next)) {
        next[s.speaker_label] = s.speaker_name ?? "";
      }
    }
    speakerNames = next;
  });
  const speakerLabels = $derived(Object.keys(speakerNames));

  // Editable transcript text per segment id, synced from server data.
  let segmentTexts = $state<Record<number, string>>({});
  $effect(() => {
    const next: Record<number, string> = {};
    for (const s of data.segments) next[s.id] = s.text;
    segmentTexts = next;
  });

  let instructions = $state("");
  $effect(() => {
    instructions = data.meeting.instructions ?? "";
  });

  let transcriptExpanded = $state(false);
  let notesExpanded = $state(false);
  let deleting = $state(false);

  // Notes come from the server load; a freshly-generated result overrides that
  // until the next invalidateAll() folds it back into data.notes.
  let notesOverride = $state<string | null>(null);
  const notes = $derived(notesOverride ?? data.notes);

  let savingSpeakers = $state(false);
  let generating = $state(false);
  let actionError = $state<string | null>(null);

  const STATUS_LABELS: Record<string, string> = {
    uploaded: "Uploaded",
    queued: "Queued",
    transcribing: "Transcribing…",
    transcribed: "Transcribed",
    notes_ready: "Notes ready",
    failed: "Failed",
  };

  const isProcessing = $derived(
    meeting.status === "uploaded" || meeting.status === "queued" || meeting.status === "transcribing"
  );

  // Poll status while the consumer is still working, then reload server data
  // (which pulls in the freshly-inserted transcript segments).
  $effect(() => {
    if (!isProcessing) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/${meeting.id}/status`);
        if (!res.ok) return;
        const { status } = (await res.json()) as { status: string };
        if (status !== meeting.status) await invalidateAll();
      } catch {
        // transient — keep polling
      }
    }, 4000);
    return () => clearInterval(timer);
  });

  function displayName(label: string): string {
    const name = speakerNames[label]?.trim();
    return name ? name : label;
  }

  async function saveSpeakers() {
    savingSpeakers = true;
    actionError = null;
    try {
      const mapping: Record<string, string> = {};
      for (const [label, name] of Object.entries(speakerNames)) {
        const trimmed = name.trim();
        if (trimmed) mapping[label] = trimmed;
      }
      const res = await fetch(`/api/meetings/${meeting.id}/speakers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      savingSpeakers = false;
    }
  }

  async function saveSegmentText(segmentId: number, original: string) {
    const text = segmentTexts[segmentId];
    if (text === original) return;
    actionError = null;
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    }
  }

  async function saveInstructions() {
    if (instructions === (data.meeting.instructions ?? "")) return;
    actionError = null;
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    }
  }

  async function deleteMeeting() {
    if (!confirm("Delete this meeting? This can't be undone.")) return;
    deleting = true;
    actionError = null;
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
      await goto("/");
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
      deleting = false;
    }
  }

  async function generateNotes() {
    generating = true;
    actionError = null;
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/notes`, { method: "POST" });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
      const { markdown } = (await res.json()) as { markdown: string };
      notesOverride = markdown;
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      generating = false;
    }
  }
</script>

<svelte:head><title>{meeting.title} — lz-notes</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-10">
  <a href="/" class="text-sm text-gray-500 hover:underline">← All meetings</a>

  <header class="mt-3 flex items-center justify-between">
    <h1 class="text-2xl font-bold tracking-tight">{meeting.title}</h1>
    <span class="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
      {STATUS_LABELS[meeting.status] ?? meeting.status}
    </span>
  </header>
  <div class="mt-1 flex items-center justify-between">
    <p class="text-xs tracking-wide text-gray-400 uppercase">{meeting.meeting_type}</p>
    {#if meeting.status !== "queued" && meeting.status !== "transcribing"}
      <button
        class="text-sm text-red-600 hover:underline disabled:opacity-50"
        onclick={deleteMeeting}
        disabled={deleting}
      >
        {deleting ? "Deleting…" : "Delete meeting"}
      </button>
    {/if}
  </div>

  {#if meeting.status === "failed"}
    <div class="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      Transcription failed{meeting.error ? `: ${meeting.error}` : ""}.
    </div>
  {/if}

  {#if isProcessing}
    <div class="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
      Processing your recording — this page updates automatically.
    </div>
  {/if}

  {#if data.segments.length > 0}
    <section class="mt-8">
      <h2 class="text-lg font-semibold">Speakers</h2>
      <p class="text-sm text-gray-500">Give each speaker a name to use in the notes.</p>
      <div class="mt-3 space-y-2">
        {#each speakerLabels as label (label)}
          <div class="flex items-center gap-3">
            <span class="w-28 shrink-0 font-mono text-sm text-gray-500">{label}</span>
            <input
              class="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              bind:value={speakerNames[label]}
              placeholder="Name"
            />
          </div>
        {/each}
      </div>
      <button
        class="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        onclick={saveSpeakers}
        disabled={savingSpeakers}
      >
        {savingSpeakers ? "Saving…" : "Save names"}
      </button>
    </section>

    <section class="mt-8">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Transcript</h2>
        <button
          class="text-sm text-gray-500 hover:underline"
          onclick={() => (transcriptExpanded = !transcriptExpanded)}
        >
          {transcriptExpanded ? "Collapse" : "Expand"}
        </button>
      </div>
      <div class={transcriptExpanded ? "mt-3 space-y-3" : "mt-3 max-h-[50vh] space-y-3 overflow-y-auto"}>
        {#each data.segments as segment (segment.id)}
          <div class="text-sm leading-relaxed">
            <span class="font-semibold">{displayName(segment.speaker_label)}:</span>
            <textarea
              class="mt-1 field-sizing-content w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm"
              bind:value={segmentTexts[segment.id]}
              onblur={() => saveSegmentText(segment.id, segment.text)}></textarea>
          </div>
        {/each}
      </div>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold">Context for notes (optional)</h2>
      <p class="text-sm text-gray-500">
        Add clarifications or corrections for the note-generation model — e.g. resolving ambiguous references
        or fixing mistranscribed terms.
      </p>
      <textarea
        class="mt-2 field-sizing-content w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm"
        bind:value={instructions}
        onblur={saveInstructions}
        placeholder="e.g. 'Acme' refers to Acme Corp, our vendor, not the product name."
        rows="3"></textarea>
    </section>

    <section class="mt-8">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Notes</h2>
        <button
          class="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          onclick={generateNotes}
          disabled={generating}
        >
          {generating ? "Generating…" : notes ? "Regenerate notes" : "Generate notes"}
        </button>
      </div>

      {#if actionError}
        <p class="mt-2 text-sm text-red-600">{actionError}</p>
      {/if}

      {#if notes}
        <div class="mt-4 flex gap-2">
          <a
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            href="/api/meetings/{meeting.id}/export/md">Markdown</a
          >
          <a
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            href="/api/meetings/{meeting.id}/export/docx">DOCX</a
          >
          <a
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            href="/api/meetings/{meeting.id}/export/pdf">PDF</a
          >
          {#if notes}
            <div class="flex flex-1 items-center justify-end">
              <button
                class="text-sm text-gray-500 hover:underline"
                onclick={() => (notesExpanded = !notesExpanded)}
              >
                {notesExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
          {/if}
        </div>

        <pre
          class={`mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm whitespace-pre-wrap ${notesExpanded ? "" : "max-h-[50vh] overflow-y-auto"}`}>{notes}</pre>
      {/if}
    </section>
  {/if}
</main>
