import {
  parseBackupObjects,
  parseGroupManifest,
  parseGroupReference,
  readBackupJson,
  type BackupGroupReference,
} from "./backup-format.ts";
import { copyVerifiedObject, digestStream, mapConcurrent } from "./common.ts";
import type { ObjectStore } from "./types.ts";

export interface RestoreGroupPageParams {
  store: ObjectStore;
  reference: BackupGroupReference;
  page: number;
  target: { images: ObjectStore; quarantine: ObjectStore };
  maximumObjectBytes: number;
}

async function groupPage(params: RestoreGroupPageParams) {
  if (!Number.isSafeInteger(params.maximumObjectBytes) || params.maximumObjectBytes < 1) {
    throw new Error("Invalid restore object limit.");
  }
  const reference = parseGroupReference(params.reference);
  const group = parseGroupManifest(await readBackupJson(params.store, reference), reference);
  const page = group.pages[params.page];
  if (!Number.isSafeInteger(params.page) || params.page < 0 || !page) {
    throw new Error("Invalid restore page.");
  }
  const objects = parseBackupObjects(
    await readBackupJson(params.store, page),
    group.id,
    page.objects,
  );
  return { page, objects };
}

/** A retry verifies existing destination bytes and retains every original object key. */
export async function restoreGroupPage(params: RestoreGroupPageParams) {
  const { page, objects } = await groupPage(params);
  await mapConcurrent(objects, 6, async (object) => {
    await copyVerifiedObject({
      source: params.store,
      destination: object.source === "images" ? params.target.images : params.target.quarantine,
      sourceKey: object.backupKey,
      destinationKey: object.key,
      maximum: params.maximumObjectBytes,
      expectedDigest: object.digest,
      expectedBytes: object.bytes,
    });
  });
  return {
    digest: page.digest,
    objects: objects.length,
    bytes: objects.reduce((sum, object) => sum + object.bytes, 0),
  };
}

/** Verify a restored page independently before recording the database sanitation phase. */
export async function verifyGroupPage(params: RestoreGroupPageParams) {
  const { page, objects } = await groupPage(params);
  await mapConcurrent(objects, 6, async (object) => {
    const store = object.source === "images" ? params.target.images : params.target.quarantine;
    const restored = await store.get(object.key);
    if (!restored || restored.size !== object.bytes) {
      await restored?.body.cancel();
      throw new Error("Restored object is missing or has an invalid size.");
    }
    const verified = await digestStream(restored.body, params.maximumObjectBytes);
    if (verified.digest !== object.digest || verified.bytes !== object.bytes) {
      throw new Error("Restored object failed integrity verification.");
    }
  });
  return {
    digest: page.digest,
    objects: objects.length,
    bytes: objects.reduce((sum, object) => sum + object.bytes, 0),
  };
}
