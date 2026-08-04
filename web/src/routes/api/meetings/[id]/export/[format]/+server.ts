import { error } from "@sveltejs/kit";
import { NotesRepository } from "$lib/server/db";
import { exportMarkdown } from "$lib/server/export/markdown";
import { exportDocx } from "$lib/server/export/docx";
import { exportPdf } from "$lib/server/export/pdf";
import type { RequestHandler } from "./$types";

// GET /api/meetings/:id/export/:format  (format = md | docx | pdf)
// Builds the requested file from the stored notes markdown and returns it as a
// download with the correct Content-Type / Content-Disposition.
export const GET: RequestHandler = async ({ params, platform }) => {
  const repo = new NotesRepository(platform!.env.DB);

  const meeting = await repo.getMeeting(params.id);
  if (!meeting) throw error(404, "Meeting not found");

  const markdown = await repo.getNotes(params.id);
  if (markdown === null) throw error(404, "No notes have been generated yet");

  const safeTitle = meeting.title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "notes";

  let body: Blob;
  let contentType: string;
  let ext: string;

  switch (params.format) {
    case "md":
      body = new Blob([exportMarkdown(markdown)]);
      contentType = "text/markdown; charset=utf-8";
      ext = "md";
      break;
    case "docx":
      body = await exportDocx(markdown);
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      ext = "docx";
      break;
    case "pdf":
      body = new Blob([await exportPdf(markdown)]);
      contentType = "application/pdf";
      ext = "pdf";
      break;
    default:
      throw error(400, "format must be 'md', 'docx', or 'pdf'");
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeTitle}.${ext}"`,
    },
  });
};
