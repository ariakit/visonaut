import type { VariantProps } from "../../../lab/types.ts";
import { PullPage } from "./ariakit/pull-page.tsx";

/** The Folio pull request page. It waits for the newest run. */
export default function AriakitPull(props: VariantProps) {
  return <PullPage {...props} />;
}
