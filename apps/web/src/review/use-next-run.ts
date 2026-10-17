import { useEffect, useState } from "react";
import { getRunReference } from "../components/kit/run-row.tsx";
import type { ResultNextRun } from "../components/kit/result/result-page.tsx";
import { awaitsReview } from "../dashboard/run-groups.ts";
import { fetchRunList } from "../dashboard/run-list.ts";

/**
 * The next run of the Queue that waits for a decision, for the result page.
 * It reads the run list one time each time the result shows. A read that
 * fails gives no next run, and the result links the Queue.
 */
export function useNextRun(runId: string, enabled: boolean): ResultNextRun | null {
  const [next, setNext] = useState<ResultNextRun | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchRunList(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      // The Queue lists the runs that wait for a decision first, newest first.
      const run =
        result.status === "ready"
          ? result.list.actionable.find((entry) => entry.id !== runId && awaitsReview(entry))
          : undefined;
      setNext(run ? { label: getRunReference(run), runId: run.id } : null);
    });
    // The next result reads the list again, and it shows no run of this read.
    return () => {
      controller.abort();
      setNext(null);
    };
  }, [runId, enabled]);
  return enabled ? next : null;
}
