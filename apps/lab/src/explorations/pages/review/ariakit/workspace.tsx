import { cx } from "clava";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Heading,
  HeadingLevel,
} from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Shell,
  ShellMain,
  ShellMainBody,
  ShellSidebar,
} from "../../../../components/ariakit/components/shell.ariakit.react.tsx";
import { useReviewShortcuts } from "../../../../fixtures/hooks/index.ts";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { ReviewBar } from "../../../kits/ariakit/bar/bar.tsx";
import {
  ShortcutsDialog,
  reviewKeyGroups,
  usePageKeys,
  useShortcuts,
} from "../../../kits/ariakit/keys.tsx";
import { ScreenshotList } from "../../../kits/ariakit/list/screenshot-list.tsx";
import { useScreenshotList } from "../../../kits/ariakit/list/use-screenshot-list.ts";
import { getRunProgress } from "../../../kits/ariakit/result/model.ts";
import { ResultPage } from "../../../kits/ariakit/result/result-page.tsx";
import { useDocumentTitle } from "../../../kits/ariakit/shell.tsx";
import { DetailsButton } from "../../../kits/ariakit/stage/details.tsx";
import { ReviewStage } from "../../../kits/ariakit/stage/stage.tsx";
import { ChangeLine } from "../../../kits/ariakit/stage/summary.tsx";
import { useStageView } from "../../../kits/ariakit/stage/view.ts";
import type { StageEngine } from "../../../kits/ariakit/stage/view.ts";
import { Sheet } from "../../../kits/ariakit/surfaces.tsx";
import { pageRoot, shellRadius } from "../../../kits/ariakit/tokens.ts";
import { VariantNav } from "../../../kits/ariakit/variants/variant-nav.tsx";
import { useStoredView } from "../../../kits/ariakit/view-store.ts";
import type { StoredView } from "../../../kits/ariakit/view-types.ts";
import { Cover } from "./cover.tsx";
import { Stepper, WorkspaceHeader } from "./header.tsx";
import {
  besideList,
  panelGutter,
  stageRoomClass,
  stepperWidth,
  variantNavRoom,
  variantRowClass,
  wideRowOnly,
} from "./layout.ts";
import { getRunIdentity } from "./model.ts";
import { PanelSheet } from "./panel-sheet.tsx";
import { useStableCallback } from "./use-stable-callback.ts";
import { useWorkspace } from "./use-workspace.ts";
import type { Workspace as WorkspaceState } from "./use-workspace.ts";

interface StageBoxProps {
  session: ReviewSessionReady;
  view: StageEngine;
  stored: StoredView;
  workspace: WorkspaceState;
}

/**
 * The stage, or the cover in its place, with the one bar over its bottom.
 * Put it in a column.
 */
function StageBox({ session, view, stored, workspace }: StageBoxProps) {
  const { item, variant } = session;
  const { cover } = workspace;
  const { images } = view;
  // The decisions are off from the moment that the stage says that it waits
  // for an image. A cell of the cover loads its own picture.
  const ready = cover || (!images.failed && !images.late);
  const content =
    cover && item ? (
      <Cover
        item={item}
        variant={variant}
        side={stored.mode === "original" ? "baseline" : "current"}
        mask={stored.mask}
        onOpen={workspace.openVariant}
      />
    ) : (
      <ReviewStage
        variant={variant}
        item={item}
        view={view}
        mode={stored.mode}
        mask={stored.mask}
        gutterBottom={4}
        className="flex-1"
      />
    );
  return (
    // The pill lies over this box, so the box is as large as the stage.
    <div className="relative flex min-h-0 flex-1">
      {content}
      <ReviewBar session={session} view={view} stored={stored} cover={cover} ready={ready} />
    </div>
  );
}

interface PanelProps extends StageBoxProps {
  /** The selected screenshot has a cover. */
  hasCover: boolean;
  onShowAll(): void;
}

/** The main panel: the result page, or the variant control over the stage. */
function Panel({ hasCover, onShowAll, ...props }: PanelProps) {
  const { session, workspace } = props;
  const { item, variant, review } = session;
  if (workspace.result) {
    return (
      <PanelSheet>
        <ResultPage session={session} onLeave={workspace.leaveResult} onShowAll={onShowAll} />
      </PanelSheet>
    );
  }
  if (!item || !variant) return <PanelSheet />;
  // The numbers and the other facts are those of one variant. The cells of
  // the cover have their own.
  const line = !workspace.cover && (
    <ChangeLine variant={variant} className={cx("flex-none", wideRowOnly)} />
  );
  const details = !workspace.cover && (
    <DetailsButton review={review} item={item} variant={variant} />
  );
  return (
    <PanelSheet>
      {/* A frame, so the stepper takes the radius that is concentric with
          the panel. */}
      <Frame $p={2} className={variantRowClass}>
        <div className={variantNavRoom}>
          <VariantNav
            item={item}
            variant={variant}
            cover={workspace.cover}
            onCoverChange={hasCover ? workspace.setCover : undefined}
            onStep={workspace.stepVariant}
            onSelect={workspace.openVariant}
          />
        </div>
        {line}
        {details && <span className="ms-auto flex flex-none">{details}</span>}
      </Frame>
      <Frame $p={2} className={stageRoomClass}>
        <StageBox {...props} />
      </Frame>
    </PanelSheet>
  );
}

export interface WorkspaceProps {
  session: ReviewSessionReady;
}

/**
 * The review workspace for a run that loaded: the header, the list of the
 * screenshots with a change on the desk, and the main panel with the variant
 * control, the stage, and the bar. The page never scrolls. The stage takes
 * all the height that is left.
 */
export function Workspace({ session }: WorkspaceProps) {
  const stored = useStoredView();
  const shortcuts = useShortcuts();
  const sessionList = useScreenshotList(session);
  const { item, variant, review } = session;
  const view = useStageView({ variant, mode: stored.mode, expired: review.imagesExpired });
  // The cover shows what a decision for the whole screenshot covers, so the
  // stepper offers it only for a screenshot that takes a decision.
  const hasCover = (item?.counts.reviewable ?? 0) > 0;
  const workspace = useWorkspace({
    session,
    list: sessionList,
    stored,
    hasCover,
    // A key decides only what is on screen.
    imagesReady: !view.images.failed && !view.images.loading,
  });
  const { list } = workspace;
  const identity = getRunIdentity(review);
  useDocumentTitle(`${getRunProgress(session).label} · ${identity.full}`);

  // The keys of the app today, and `W` and `O` (D-WORK-03, D-WORK-02). The
  // mode and the mask are the stored view, not the viewer of the session.
  const keys: Record<string, (event: KeyboardEvent) => void> = {
    arrowup: () => workspace.stepItem(-1),
    arrowdown: () => workspace.stepItem(1),
    arrowleft: () => workspace.stepVariant(-1),
    arrowright: () => workspace.stepVariant(1),
    a: (event) => workspace.decide("approve", event.shiftKey),
    x: (event) => workspace.decide("reject", event.shiftKey),
    f: () => workspace.setMode("new"),
    g: () => workspace.setMode("original"),
    s: () => workspace.setMode("side"),
    w: () => workspace.setMode("swipe"),
    o: () => workspace.setMode("overlay"),
    // D is the mask switch of D-WORK-02, not a mode.
    d: workspace.toggleMask,
  };
  // The app binds `1` to `6`. The session also binds `7` to `9`.
  for (let position = 1; position <= 9; position++) {
    keys[String(position)] = () => {
      if (position > 6) return;
      workspace.openVariant(position - 1);
    };
  }
  useReviewShortcuts(session, { labKeys: false, enabled: shortcuts.enabled, keys });
  usePageKeys({
    "[": () => {
      // In a frame of the lab, `[` and `]` change the variant of the explorer.
      if (window.parent !== window) return false;
      workspace.setListOpen(!workspace.listOpen);
      return true;
    },
  });

  const showAll = () => {
    list.setStatus("unchanged");
    workspace.setListOpen(true);
    workspace.setInlineListOpen(true);
  };
  // The stage is under the list of a narrow window, so a choice closes it.
  const selectInline = useStableCallback((itemKey: string) => {
    list.select(itemKey);
    workspace.setInlineListOpen(false);
  });
  const stepperProps = {
    item: workspace.result ? null : item,
    family: item ? (list.labels.get(item.family) ?? item.family) : null,
    position: list.position,
    count: list.order.length,
    onStep: workspace.stepItem,
  };

  return (
    <HeadingLevel level={1}>
      <Shell $rounded={shellRadius} className={cx(pageRoot, "h-dvh")}>
        <WorkspaceHeader
          session={session}
          onShowResult={workspace.showResult}
          stepper={
            <HeadingLevel>
              <Stepper
                {...stepperProps}
                listOpen={workspace.listOpen}
                onListOpenChange={workspace.setListOpen}
                className={stepperWidth}
              />
            </HeadingLevel>
          }
        />
        <ShellSidebar
          open={workspace.listOpen}
          $width="lg"
          $border={false}
          aria-label="Screenshots"
          render={<nav />}
        >
          <ScreenshotList list={list} />
        </ShellSidebar>
        <ShellMain $p="none" $maxWidth="100%">
          <ShellMainBody className="grid-rows-[minmax(0,1fr)]">
            <Frame $p={2} className={cx(panelGutter, workspace.listOpen && besideList)}>
              <Heading className="sr-only">{`Review of ${identity.full}`}</Heading>
              <HeadingLevel>
                <div className="flex flex-none flex-col gap-2 @3xl/shell:hidden">
                  <Stepper
                    {...stepperProps}
                    listOpen={workspace.inlineListOpen}
                    onListOpenChange={workspace.setInlineListOpen}
                  />
                  {workspace.inlineListOpen && (
                    <Sheet
                      $p="none"
                      render={<nav aria-label="Screenshots" />}
                      className="flex max-h-72 min-h-0 flex-col"
                    >
                      <ScreenshotList list={{ ...list, select: selectInline }} />
                    </Sheet>
                  )}
                </div>
                <Panel
                  session={session}
                  view={view}
                  stored={stored}
                  workspace={workspace}
                  hasCover={hasCover}
                  onShowAll={showAll}
                />
              </HeadingLevel>
            </Frame>
          </ShellMainBody>
        </ShellMain>
      </Shell>
      <ShortcutsDialog groups={reviewKeyGroups} readOnly={session.readOnly} />
      <div role="status" aria-live="polite" className="sr-only">
        {session.announcement}
      </div>
    </HeadingLevel>
  );
}
