import { codecsReady } from "./source/apps/compare/src/codecs.ts";
import { validateRequest } from "./source/apps/compare/src/validate.ts";
export default {
  async fetch(request) {
    return validateRequest(request, await codecsReady);
  },
};
