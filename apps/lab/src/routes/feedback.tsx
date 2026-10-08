import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, MessageSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Code } from "../components/ariakit/components/code.ariakit.react.tsx";
import {
  Dialog,
  DialogDescription,
  DialogDisclosure,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
} from "../components/ariakit/components/dialog.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Input } from "../components/ariakit/components/input.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";
import {
  Table,
  TableCell,
  TableRow,
  TableRowGroup,
} from "../components/ariakit/components/table.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { catalog } from "../lab/catalog.ts";
import { discardFeedbackRound, feedbackStorageKey, useFeedback } from "../lab/feedback-store.ts";
import {
  buildContinuationPrompt,
  countAnswered,
  getChangedSurfaces,
  getDecisionFeedback,
  getOpenSurfaces,
  isDecisionChanged,
} from "../lab/feedback.ts";
import type { DecisionFeedback } from "../lab/feedback.ts";
import { getSettledLabel, record, settledDecisions } from "../lab/record.ts";
import type { SettledDecision, SettledRound } from "../lab/record.ts";
import { findSurface, findVariant, getLabTitle } from "../lab/surfaces.ts";
import type { SurfaceEntry } from "../lab/types.ts";
import { CatalogText } from "../lab/ui/catalog-text.tsx";
import { SurfaceLink, useDecisionJump } from "../lab/ui/links.tsx";
import { DecisionStatusBadge } from "../lab/ui/surface-card.tsx";

export const Route = createFileRoute("/feedback")({
  head: () => ({ meta: [{ title: getLabTitle("Feedback") }] }),
  component: Feedback,
});

// A button without a surface in a table cell. The margins take the padding of
// the button back, so its label starts at the text edge of the column and on
// the first text line of the row.
const cellActionClass = "-ms-3.5 -mt-2";

interface DecisionNotesProps {
  surface: SurfaceEntry;
  feedback?: DecisionFeedback;
  /** The text of a decision without notes and marks. */
  empty?: string;
}

/** The notes of a decision and the marks of its variants, as plain text. */
function DecisionNotes({ surface, feedback, empty = "" }: DecisionNotesProps) {
  const notes = feedback?.notes?.trim();
  const marks = Object.entries(feedback?.variants ?? {}).filter(([, value]) => {
    return value.mark || value.note?.trim();
  });
  if (!notes && !marks.length) {
    return <Text className="ak-ink-40">{empty}</Text>;
  }
  return (
    <div className="grid gap-1.5">
      {notes && <Text className="whitespace-pre-wrap">{notes}</Text>}
      {marks.map(([id, value]) => (
        <div key={id} className="flex items-start gap-2 ak-ink-70">
          <span className="flex h-lh items-center">
            {value.mark === "like" && <ThumbsUp className="size-3.5" aria-label="Liked" />}
            {value.mark === "drop" && <ThumbsDown className="size-3.5" aria-label="Dropped" />}
            {!value.mark && <MessageSquare className="size-3.5" aria-label="Note" />}
          </span>
          <Text>
            {findVariant(surface, id)?.name ?? id}
            {value.note?.trim() ? `: ${value.note.trim()}` : ""}
          </Text>
        </div>
      ))}
    </div>
  );
}

function ChangedBadge() {
  return (
    <Badge $forceRounded $layer="transparent" className="ak-ink-60">
      Changed
    </Badge>
  );
}

function DiscardRound({ disabled }: { disabled: boolean }) {
  return (
    <DialogProvider>
      <DialogDisclosure $ink={70} disabled={disabled}>
        Discard this round
      </DialogDisclosure>
      <Dialog unmountOnHide className="flex flex-col gap-4 text-sm">
        <div className="grid gap-1">
          <DialogHeading>Discard this round?</DialogHeading>
          <DialogDescription className="ak-ink-70">
            Every pick, note, and mark returns to revision {record.revision} of the record. The
            record itself does not change.
          </DialogDescription>
        </div>
        <div className="flex justify-end gap-2">
          <DialogDismiss $lightnessOffset>Keep</DialogDismiss>
          <DialogDismiss $layer="danger" onClick={discardFeedbackRound}>
            Discard
          </DialogDismiss>
        </div>
      </Dialog>
    </DialogProvider>
  );
}

interface DecisionNameProps {
  title: string;
  decision: string;
  /** The question of an open decision. */
  question?: string;
}

function DecisionName({ title, decision, question }: DecisionNameProps) {
  return (
    <div className="grid gap-1">
      <Text className="font-medium">{title}</Text>
      {question && (
        <Text className="max-w-prose text-pretty ak-ink-70">
          <CatalogText>{question}</CatalogText>
        </Text>
      )}
      <Code className="justify-self-start text-xs">{decision}</Code>
    </div>
  );
}

/** The decisions that the maintainer can make in this round. */
function OpenTable() {
  const feedback = useFeedback();
  const jump = useDecisionJump();
  return (
    <Table $border container={{ $border: true, $rounded: "xl" }} className="w-full">
      <TableRowGroup group="head">
        <TableRow>
          <TableCell header className="w-2/5">
            Decision
          </TableCell>
          <TableCell header>Status</TableCell>
          <TableCell header className="w-1/3">
            Notes and marks
          </TableCell>
          <TableCell header>
            <span className="sr-only">Decide</span>
          </TableCell>
        </TableRow>
      </TableRowGroup>
      <TableRowGroup>
        {getOpenSurfaces(catalog).map((surface) => (
          <TableRow key={surface.decision} className="align-top">
            <TableCell header="row" className="text-start font-normal">
              <DecisionName
                title={surface.title}
                decision={surface.decision}
                question={surface.question}
              />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5">
                <DecisionStatusBadge $forceRounded surface={surface} className="max-w-48" />
                {isDecisionChanged(feedback, surface.decision) && <ChangedBadge />}
              </div>
            </TableCell>
            <TableCell>
              <DecisionNotes
                surface={surface}
                feedback={getDecisionFeedback(feedback.current, surface.decision)}
                empty="None"
              />
            </TableCell>
            <TableCell>
              {/* "Open" is a decision status here, so the action has
                  another word. */}
              <Button
                $size="sm"
                aria-label={`Decide ${surface.decision}`}
                onClick={() => jump(surface)}
                className={cellActionClass}
              >
                <ButtonLabel>Decide</ButtonLabel>
                <ButtonSlot>
                  <ArrowRight />
                </ButtonSlot>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableRowGroup>
    </Table>
  );
}

interface SettledRowProps {
  settled: SettledDecision;
}

/**
 * One decision of the record. A decision whose surface is still in the lab
 * takes notes, so its row shows the notes of this browser and says when they
 * differ from the record.
 */
function SettledRow({ settled }: SettledRowProps) {
  const feedback = useFeedback();
  const { decision, place } = settled;
  const surface = catalog.surfaces.find((entry) => entry.decision === decision);
  const target = findSurface(place.kind, place.surface);
  return (
    <TableRow className="align-top">
      <TableCell header="row" className="text-start font-normal">
        <DecisionName title={settled.title} decision={decision} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Text>{settled.pickName}</Text>
          {surface && isDecisionChanged(feedback, decision) && <ChangedBadge />}
        </div>
      </TableCell>
      <TableCell>
        {settled.notPicked && (
          <Text>
            <CatalogText>{settled.notPicked}</CatalogText>
          </Text>
        )}
        {!settled.notPicked && surface && (
          <DecisionNotes
            surface={surface}
            feedback={getDecisionFeedback(feedback.current, decision)}
          />
        )}
        {!settled.notPicked && !surface && (
          <Text className="whitespace-pre-wrap">{settled.note}</Text>
        )}
      </TableCell>
      <TableCell>
        <div className="grid justify-items-start gap-1">
          {target && (
            <Button
              $size="sm"
              className={cellActionClass}
              render={<SurfaceLink surface={target} />}
            >
              <ButtonLabel>{target.title}</ButtonLabel>
              <ButtonSlot>
                <ArrowRight />
              </ButtonSlot>
            </Button>
          )}
          {place.part && <Text className="text-xs ak-ink-60">{place.part}</Text>}
        </div>
      </TableCell>
    </TableRow>
  );
}

interface SettledTableProps {
  decisions: SettledDecision[];
}

/** The decisions of one round, with the place of each pick in the lab. */
function SettledTable({ decisions }: SettledTableProps) {
  // A decision of round 2 has no note. It says what was not picked.
  const notPicked = decisions.some((settled) => settled.notPicked);
  return (
    <Table $border container={{ $border: true, $rounded: "xl" }} className="w-full">
      <TableRowGroup group="head">
        <TableRow>
          <TableCell header>Decision</TableCell>
          <TableCell header>Pick</TableCell>
          <TableCell header className="w-2/5">
            {notPicked ? "Not picked" : "Note"}
          </TableCell>
          <TableCell header>Now in</TableCell>
        </TableRow>
      </TableRowGroup>
      <TableRowGroup>
        {decisions.map((settled) => (
          <SettledRow key={settled.decision} settled={settled} />
        ))}
      </TableRowGroup>
    </Table>
  );
}

interface SettledSectionProps {
  round: SettledRound;
  /** One sentence about the table of the round. */
  hint: string;
}

// The rounds with settled decisions, the newest first.
const settledRounds: SettledSectionProps[] = [
  { round: 2, hint: "Each option that was not picked left the lab. The page is the pick." },
  { round: 1, hint: "A pick without a surface of its own is now part of a page." },
];

function SettledSection({ round, hint }: SettledSectionProps) {
  const decisions = settledDecisions.filter((settled) => settled.round === round);
  const headingId = `feedback-settled-${round}`;
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Heading id={headingId} className="text-base font-semibold">
          {getSettledLabel(round)}
        </Heading>
        <Text className="text-xs tabular-nums ak-ink-50">{decisions.length}</Text>
        <Text className="ms-2 ak-ink-60">{hint}</Text>
      </div>
      <SettledTable decisions={decisions} />
    </section>
  );
}

function Feedback() {
  const feedback = useFeedback();
  const open = getOpenSurfaces(catalog).length;
  const answered = countAnswered(feedback, catalog);
  const changed = getChangedSurfaces(feedback, catalog).length;
  const prompt = buildContinuationPrompt({ stored: feedback, catalog, record });
  return (
    <ShellMain $p={6} $maxWidth="76rem">
      <ShellMainBody className="gap-y-10">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="grid gap-1">
            <Heading className="text-xl font-semibold tracking-tight">Feedback</Heading>
            <Text className="ak-ink-60">
              {/* With no open decision, a count of 0 of 0 reads as an error. */}
              {open > 0
                ? `${answered} / ${open} answered`
                : `No open decision · ${settledDecisions.length} settled`}
              {` · ${changed} changed since revision ${record.revision}`}
            </Text>
          </div>
          <DiscardRound disabled={!changed} />
        </header>

        <HeadingLevel>
          {open > 0 && (
            <section className="grid gap-3" aria-labelledby="feedback-open">
              <div className="flex items-baseline gap-2">
                <Heading id="feedback-open" className="text-base font-semibold">
                  Open
                </Heading>
                <Text className="text-xs tabular-nums ak-ink-50">{open}</Text>
              </div>
              <OpenTable />
            </section>
          )}

          {settledRounds.map(({ round, hint }) => (
            <SettledSection key={round} round={round} hint={hint} />
          ))}

          <section className="grid gap-3" aria-labelledby="feedback-prompt">
            <div className="grid gap-1">
              <Heading id="feedback-prompt" className="text-base font-semibold">
                Continuation prompt
              </Heading>
              <Text className="max-w-prose ak-ink-60">
                It lists only the decisions that changed since revision {record.revision}. A note on
                a settled page is such a change. The button in the top bar copies this text. Copying
                does not start a new round.
              </Text>
            </div>
            <Input
              // The whole prompt shows without a scroll while it is short.
              render={<textarea readOnly rows={Math.min(32, prompt.split("\n").length + 1)} />}
              value={prompt}
              aria-labelledby="feedback-prompt"
              className="resize-y font-mono text-xs leading-relaxed"
              onFocus={(event) => event.currentTarget.select()}
            />
          </section>

          <section className="grid max-w-prose gap-2" aria-labelledby="feedback-storage">
            <Heading id="feedback-storage" className="text-base font-semibold">
              Where feedback is saved
            </Heading>
            <Text className="ak-ink-70">
              Picks, notes, and marks stay in this browser, in local storage under{" "}
              <Code className="whitespace-nowrap">{feedbackStorageKey}</Code>. Nothing is sent
              anywhere. An agent sees your feedback only when you paste the continuation prompt into
              a session.
            </Text>
            <Text className="ak-ink-70">
              A new round starts when an agent merges the prompt into the record and changes the
              revision in{" "}
              <Code className="whitespace-nowrap">{record.labPath}/src/lab/record.ts</Code>.
            </Text>
          </section>
        </HeadingLevel>
      </ShellMainBody>
    </ShellMain>
  );
}
