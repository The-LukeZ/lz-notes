import { NotesRepository } from "$lib/server/db";
import { error } from "@sveltejs/kit";

export const handle = async ({ event, resolve }) => {
  if (event.platform?.env) {
    const db = new NotesRepository(event.platform.env.DB);
    event.locals.db = db;
  } else {
    error(500, "Missing platform env");
  }
  return resolve(event);
};
