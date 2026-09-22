import { createGitHubClient, GitHubUnavailableError } from "../src/github.js";

export default {
  async fetch(request: Request) {
    const privateKey = await request.text();
    try {
      const github = await createGitHubClient({
        appId: "123",
        installationId: "456",
        repositoryId: "789",
        repository: "ariakit/ariakit",
        privateKey,
      });
      await github.request("/user/42");
      return new Response("verified");
    } catch (error) {
      if (error instanceof GitHubUnavailableError)
        return Response.json({ upstreamStatus: error.upstreamStatus }, { status: error.status });
      throw error;
    }
  },
};
