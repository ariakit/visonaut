import {
  reconcileWork,
  reportComparisonPublication,
  Service,
  type Database,
} from "@visonaut/service";

export async function runScheduledComparisons(
  database: Database,
  publish: (taskId: string) => Promise<void>,
  now: () => number,
) {
  const publication = await reconcileWork(database, {
    now: now(),
    limit: 100,
    kind: "compare",
    scope: "current-comparison",
    publish,
  });
  await reportComparisonPublication(database, publication, now());
  const service = new Service(database);
  const recovered = await service.reconcileComparisons({ now: now(), limit: 100 });
  if (recovered.errors.length) {
    console.error(
      JSON.stringify({ event: "comparison-finalization-failed", count: recovered.errors.length }),
    );
  }
}
