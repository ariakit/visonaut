import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AppHeader } from "../components/app-shell.tsx";
import { UserMenu } from "../components/user-menu.tsx";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { LogIn, RotateCcw } from "lucide-react";
import { ControlButton as Button } from "../components/control-button.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Shell,
  ShellMain,
  ShellMainBody,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { createReviewCommands, loadReviewModel } from "../review/client.ts";
import { ReviewCommandError } from "../review/model.ts";
import type { ReviewModel, ReviewSelection } from "../review/model.ts";
import { ReviewWorkspace } from "../review/review-workspace.tsx";
import type { ReviewRoute } from "../review/review-workspace.tsx";

export const Route = createFileRoute("/runs/$runId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { comparison?: string; item?: string; variant?: string } => ({
    comparison: typeof search.comparison === "string" ? search.comparison : undefined,
    item: typeof search.item === "string" ? search.item : undefined,
    variant: typeof search.variant === "string" ? search.variant : undefined,
  }),
  ssr: false,
  // Do not hold the hydrated loading shell after the model is ready.
  pendingMinMs: 0,
  loaderDeps: ({ search }) => ({ comparison: search.comparison }),
  gcTime: 0,
  staleTime: Infinity,
  loader: async ({ params, deps, abortController }) => {
    try {
      const model = await loadReviewModel(params.runId, deps.comparison, abortController.signal);
      return { status: "ready" as const, model };
    } catch (error) {
      if (error instanceof ReviewCommandError && error.status === 401) {
        return { status: "guest" as const };
      }
      throw error;
    }
  },
  pendingComponent: () => <RunLoading />,
  errorComponent: ({ error, reset }) => <RunError error={error} reset={reset} />,
  component: Run,
});

type RunState = { status: "guest" } | { status: "ready"; model: ReviewModel };

function RunShell({ children }: { children: ReactNode }) {
  return (
    <Shell $layer="canvas" className="text-sm [--shell-header-step:calc(48px/14)]">
      <AppHeader />
      <ShellMain>
        <ShellMainBody className="min-h-[60dvh] items-center">{children}</ShellMainBody>
      </ShellMain>
    </Shell>
  );
}

function RunLoading() {
  return (
    <RunShell>
      <Text render={<p />} role="status" className="text-sm opacity-60">
        Checking access and loading this run…
      </Text>
    </RunShell>
  );
}

function RunError({ error, reset }: { error: unknown; reset(): void }) {
  const router = useRouter();
  const message =
    error instanceof ReviewCommandError && error.status === 403
      ? "Write access to this repository is required to open this run."
      : error instanceof Error
        ? error.message
        : "The run could not be loaded. Please retry.";
  return (
    <RunShell>
      <Frame
        $layer="canvas"
        $lighten={2}
        $rounded="2xl"
        $p={6}
        $border
        className="grid gap-4 text-sm"
      >
        <Text render={<h1 />} className="text-2xl font-semibold tracking-tight">
          This run could not be opened
        </Text>
        <p role="alert">{message}</p>
        <Button
          onClick={() => {
            void router.invalidate().then(reset);
          }}
        >
          <ButtonSlot>
            <RotateCcw />
          </ButtonSlot>
          <ButtonLabel>Retry</ButtonLabel>
        </Button>
      </Frame>
    </RunShell>
  );
}

function Run() {
  const { runId } = Route.useParams();
  const { comparison, item, variant } = Route.useSearch();
  const navigate = useNavigate();
  const state = Route.useLoaderData();
  const onSelect = useCallback(
    (selection: ReviewSelection) => {
      void navigate({
        to: "/runs/$runId",
        params: { runId },
        search: {
          comparison,
          item: selection.itemKey,
          variant: selection.variantKey,
        },
        replace: true,
      });
    },
    [comparison, navigate, runId],
  );
  const route: ReviewRoute = {
    runId,
    comparisonId: comparison,
    selection: item && variant ? { itemKey: item, variantKey: variant } : undefined,
    onSelect,
  };
  return (
    <RunPage
      key={`${runId}:${comparison ?? ""}`}
      runId={runId}
      comparisonId={comparison}
      route={route}
      state={state}
    />
  );
}

function RunPage({
  runId,
  comparisonId,
  route,
  state,
}: {
  runId: string;
  comparisonId?: string;
  route: ReviewRoute;
  state: RunState;
}) {
  const commands = useMemo(() => createReviewCommands(runId, comparisonId), [runId, comparisonId]);
  const [action, setAction] = useState<"sign-in" | "sign-out" | null>(null);
  const [actionError, setActionError] = useState("");

  const signIn = async () => {
    setAction("sign-in");
    setActionError("");
    try {
      const search = new URLSearchParams();
      if (comparisonId) search.set("comparison", comparisonId);
      if (route.selection) {
        search.set("item", route.selection.itemKey);
        search.set("variant", route.selection.variantKey);
      }
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: `/runs/${encodeURIComponent(runId)}${search.size ? `?${search}` : ""}`,
      });
      if (result.error) throw new Error("Sign-in could not start. Please try again.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Sign-in could not start. Please try again.",
      );
      setAction(null);
    }
  };
  const signOut = async () => {
    setAction("sign-out");
    setActionError("");
    try {
      const result = await createAuthClient().signOut();
      if (result.error) throw new Error("Sign-out failed. Please try again.");
      window.location.assign("/");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Sign-out failed. Please try again.");
      setAction(null);
    }
  };

  if (state.status === "ready") {
    return (
      <ReviewWorkspace
        model={state.model}
        commands={commands}
        route={route}
        headerEnd={
          <UserMenu
            preview={state.model.preview}
            signingOut={action === "sign-out"}
            error={actionError}
            onSignOut={() => void signOut()}
          />
        }
      />
    );
  }
  return (
    <RunShell>
      <Frame
        $layer="canvas"
        $lighten={2}
        $rounded="2xl"
        $p={6}
        $border
        className="grid gap-4 text-sm"
      >
        <Text render={<h1 />} className="text-2xl font-semibold tracking-tight">
          Sign in to review this run
        </Text>
        <p>This review is available to Ariakit maintainers.</p>
        {actionError && (
          <p role="alert" className="ak-text ak-text-danger">
            {actionError}
          </p>
        )}
        <Button $layer="brand" disabled={action !== null} onClick={() => void signIn()}>
          <ButtonSlot>
            <LogIn />
          </ButtonSlot>
          <ButtonLabel>
            {action === "sign-in" ? "Opening GitHub…" : "Sign in with GitHub"}
          </ButtonLabel>
        </Button>
      </Frame>
    </RunShell>
  );
}
