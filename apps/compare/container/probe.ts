import { Container } from "@cloudflare/containers";
import { ImageValidationError, readBounded } from "@visonaut/compare";
import { authorizeProbe } from "../src/probe-auth.ts";

interface ProbeEnv extends ContainerProbeEnv {
  PROBE_TOKEN: string;
}

export class ComparisonContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30s";
  enableInternet = false;
}

export default {
  async fetch(request: Request, env: ProbeEnv) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "POST" || new URL(request.url).pathname !== "/compare") {
      return new Response("Not found", { status: 404, headers });
    }
    if (!(await authorizeProbe(request, env.PROBE_TOKEN))) {
      return new Response("Unauthorized", { status: 401, headers });
    }
    if (!request.body) {
      return new Response("Comparison required", { status: 400, headers });
    }
    try {
      const body = await readBounded(request.body, 6 * 1024 * 1024);
      const response = await env.CODEC_CONTAINER.getByName("diagnostic").fetch(
        new Request("http://container/compare", {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
        }),
      );
      return new Response(response.body, {
        status: response.status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch (error) {
      if (error instanceof ImageValidationError) {
        return Response.json({ code: error.code }, { status: 413, headers });
      }
      console.error(JSON.stringify({ event: "container-probe-failed" }));
      return Response.json({ error: "Container probe failed" }, { status: 502, headers });
    }
  },
} satisfies ExportedHandler<ProbeEnv>;
