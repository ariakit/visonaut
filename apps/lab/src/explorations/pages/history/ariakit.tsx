import { useHistory } from "../../../fixtures/hooks/index.ts";
import type { VariantProps } from "../../../lab/types.ts";
import { FolioShell } from "../../kits/ariakit/shell.tsx";
import { HistoryPage } from "./ariakit/history-page.tsx";

/**
 * Folio history: a day ledger of run rows under one toolbar. The runs of one
 * pull request are one row, and its earlier runs fold under it.
 */
export default function AriakitHistory({ scenario }: VariantProps) {
  const history = useHistory(scenario);
  const loaded = history.status === "ready" || history.status === "empty";
  return (
    <FolioShell
      current="history"
      heading="History"
      title="History"
      user={loaded ? history.user : undefined}
      // A service without a run has no run to review.
      reviewCount={history.status === "empty" ? 0 : undefined}
    >
      <HistoryPage history={history} />
    </FolioShell>
  );
}
