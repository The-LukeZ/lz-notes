<script lang="ts">
  import { goto } from "$app/navigation";

  let { data } = $props();

  let title = $state("");
  let meetingType = $state<"meeting" | "learning">("meeting");
  let file = $state<FileList | null>(null);
  let glossary = $state("");
  let fileInput = $state<HTMLInputElement | null>(null);
  let fileName = $derived(file?.[0]?.name ?? "No file chosen");
  let uploading = $state(false);
  let errorMsg = $state<string | null>(null);

  const STATUS_LABELS: Record<string, string> = {
    uploaded: "Uploaded",
    queued: "Queued",
    transcribing: "Transcribing…",
    transcribed: "Transcribed",
    notes_ready: "Notes ready",
    failed: "Failed",
  };

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    errorMsg = null;

    const selected = file?.[0];
    if (!selected) {
      errorMsg = "Please choose an audio file.";
      return;
    }

    uploading = true;
    try {
      const form = new FormData();
      form.set("file", selected);
      form.set("title", title);
      form.set("meetingType", meetingType);
      if (glossary.trim() !== "") form.set("glossary", glossary);

      const res = await fetch("/api/meetings", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.text()) || `Upload failed (${res.status})`);
      const { id } = (await res.json()) as { id: string };

      // Kick off transcription immediately, then jump to the detail page,
      // which polls for status.
      await fetch(`/api/meetings/${id}/transcribe`, { method: "POST" });
      await goto(`/meeting/${id}`);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      uploading = false;
    }
  }
</script>

<svelte:head><title>lz-notes</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-10">
  <div class="flex items-center gap-2">
    <img src="/icon-192.png" alt="lz-notes logo" class="size-8" />
    <h1 class="text-3xl font-bold tracking-tight">lz-notes</h1>
  </div>
  <p class="mt-1 text-gray-500">Turn recorded meetings into structured notes.</p>

  <section class="mt-8 rounded-xl border border-gray-200 p-6 shadow-sm">
    <h2 class="text-lg font-semibold">New meeting</h2>
    <form class="mt-4 space-y-4" onsubmit={handleSubmit}>
      <div>
        <label class="block text-sm font-medium" for="title">Title</label>
        <input
          id="title"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          bind:value={title}
          placeholder="Weekly sync"
          required
        />
      </div>

      <div>
        <span class="block text-sm font-medium">Type</span>
        <div class="mt-1 flex gap-4">
          <label class="flex items-center gap-2">
            <input type="radio" bind:group={meetingType} value="meeting" /> Meeting
          </label>
          <label class="flex items-center gap-2">
            <input type="radio" bind:group={meetingType} value="learning" /> Learning session
          </label>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium" for="file">Audio file</label>
        <input
          bind:this={fileInput}
          id="file"
          type="file"
          accept="audio/*"
          class="sr-only"
          bind:files={file}
          required
        />
        <div class="mt-1 flex items-center gap-3">
          <button
            type="button"
            class="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
            onclick={() => fileInput?.click()}
          >
            Choose file
          </button>
          <span class="text-sm text-gray-500">{fileName}</span>
        </div>
      </div>

      <details class="rounded-md border border-gray-200 px-3 py-2">
        <summary class="cursor-pointer text-sm font-medium">Glossary (optional)</summary>
        <div class="mt-2">
          <label class="block text-sm text-gray-500" for="glossary">
            Provide up to 100 words or phrases to guide the model toward correct spellings of names, technical
            terms, or domain-specific vocabulary. Particularly useful for proper nouns or industry terminology
            that standard models often miss. Context biasing is optimized for English; support for other
            languages is experimental.
          </label>
          <textarea
            id="glossary"
            class="mt-2 field-sizing-content w-full resize-none rounded-md border border-gray-300 px-3 py-2"
            bind:value={glossary}
            placeholder={"One word or phrase per line, e.g.\nKubernetes\nAcme Corp\nJane Doe"}
            rows="3"></textarea>
        </div>
      </details>

      {#if errorMsg}
        <p class="text-sm text-red-600">{errorMsg}</p>
      {/if}

      <button
        type="submit"
        class="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
        disabled={uploading}
      >
        {uploading ? "Uploading…" : "Upload & transcribe"}
      </button>
    </form>
  </section>

  <section class="mt-10">
    <h2 class="text-lg font-semibold">Meetings</h2>
    {#if data.meetings.length === 0}
      <p class="mt-2 text-gray-500">No meetings yet.</p>
    {:else}
      <ul class="mt-3 divide-y divide-gray-200 rounded-xl border border-gray-200">
        {#each data.meetings as meeting (meeting.id)}
          <li>
            <a
              class="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              href="/meeting/{meeting.id}"
            >
              <span>
                <span class="font-medium">{meeting.title}</span>
                <span class="ml-2 text-xs tracking-wide text-gray-400 uppercase">
                  {meeting.meeting_type}
                </span>
              </span>
              <span class="text-sm text-gray-500">
                {STATUS_LABELS[meeting.status] ?? meeting.status}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>
