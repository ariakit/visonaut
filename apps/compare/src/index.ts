import { codecsReady } from "./codecs.ts";
import { validateRequest } from "./validate.ts";

export default {
  async fetch(request: Request) {
    return validateRequest(request, await codecsReady);
  },
} satisfies ExportedHandler<Env>;
