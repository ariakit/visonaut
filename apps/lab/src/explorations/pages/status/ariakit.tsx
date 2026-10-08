import { CloudOff } from "lucide-react";
import { useStatus } from "../../../fixtures/hooks/index.ts";
import { formatCount } from "../../../fixtures/index.ts";
import type { VariantProps } from "../../../lab/types.ts";
import { ErrorBand, ErrorBandButton } from "../../kits/ariakit/error-band.tsx";
import { FolioShell } from "../../kits/ariakit/shell.tsx";
import { HealthCard } from "./ariakit/health-card.tsx";
import { StatusSkeleton } from "./ariakit/loading.tsx";
import { Meters } from "./ariakit/meters.tsx";

/**
 * The service status page of the Folio direction: one tinted card with the
 * verdict, the time of the last check, and the open alerts as disclosures,
 * then two meters. The page has no intro text: words are in the More info
 * popover. It binds no key and has no refresh button.
 */
export default function AriakitStatus({ scenario }: VariantProps) {
  const status = useStatus(scenario);
  const ready = status.status === "ready";
  const alertCount = ready ? status.alerts.length : undefined;
  return (
    <FolioShell
      current="status"
      // The health card has the visible `h1` when the page has data.
      heading={ready ? undefined : "Status"}
      title={alertCount ? `Status · ${formatCount(alertCount, "alert")}` : "Status"}
      user={ready ? status.user : undefined}
      alertCount={alertCount}
    >
      {status.status === "loading" && (
        <section aria-busy="true" aria-label="Loading status">
          <StatusSkeleton />
        </section>
      )}
      {status.status === "error" && (
        // The page keeps its shape under the band. The title says what failed,
        // so the band has no sentence of the service.
        <div className="grid min-w-0 gap-2">
          <ErrorBand
            icon={CloudOff}
            title="Could not load the status"
            errorId={status.reference}
            action={
              <ErrorBandButton busy={status.refreshing} onClick={status.refresh}>
                Try again
              </ErrorBandButton>
            }
          />
          <StatusSkeleton still />
        </div>
      )}
      {status.status === "ready" && (
        <>
          <HealthCard status={status} />
          {status.capacity && <Meters capacity={status.capacity} />}
        </>
      )}
    </FolioShell>
  );
}
