// See https://svelte.dev/docs/kit/types#app.d.ts

import type { NotesRepository } from "$lib/server/db";

// for information about these interfaces
declare global {
  namespace App {
    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }

    // interface Error {}
    interface Locals {
      db: NotesRepository;
    }
    // interface PageData {}
    // interface PageState {}
  }
}

export {};
