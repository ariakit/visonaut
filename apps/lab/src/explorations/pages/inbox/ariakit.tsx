import type { VariantProps } from "../../../lab/types.ts";
import { InboxPage } from "./ariakit/inbox-page.tsx";

/** The Folio Queue. The card of the next run has the brand tint. */
export default function AriakitInbox(props: VariantProps) {
  return <InboxPage {...props} />;
}
