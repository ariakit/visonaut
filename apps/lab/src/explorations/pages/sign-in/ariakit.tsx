import { useRouter } from "@tanstack/react-router";
import { Aperture } from "lucide-react";
import { Text } from "../../../components/ariakit/components/text.ariakit.react.tsx";
import { useSignIn } from "../../../fixtures/hooks/index.ts";
import { useLabHref } from "../../../lab/navigation.tsx";
import type { VariantProps } from "../../../lab/types.ts";
import { ShortcutsProvider } from "../../kits/ariakit/keys.tsx";
import { useDocumentTitle } from "../../kits/ariakit/shell.tsx";
import { ErrorCard, ForbiddenCard } from "./ariakit/access-cards.tsx";
import { GuestCard } from "./ariakit/guest-card.tsx";

/**
 * The sign-in and access page of the Folio direction: no header and no
 * navigation, one sheet on the desk with the one brand button of the page.
 * The card keeps its top edge in every scenario, so nothing jumps when the
 * state changes. The page binds no key: the main button of each state has
 * the focus, so Enter presses it. It is the only page of the direction with
 * a 16 px base.
 */
export default function AriakitSignIn({ scenario }: VariantProps) {
  const router = useRouter();
  const queueHref = useLabHref("inbox", "busy");
  const signIn = useSignIn(scenario, {
    // The app returns from GitHub with a session. The lab opens the Queue.
    onRedirect: () => void router.navigate({ href: queueHref }),
  });
  const { status } = signIn;
  useDocumentTitle("Sign in");
  return (
    // The provider gives the `↵` hints the keyboard switch of the browser.
    <ShortcutsProvider>
      <div className="grid min-h-dvh content-start justify-items-center gap-4 px-4 pt-[14dvh] pb-8 text-base sm:pt-[26dvh]">
        <Text className="flex items-center gap-2 font-semibold" render={<p />}>
          <Text $text="brand" className="flex" aria-hidden>
            <Aperture strokeWidth={1.75} className="size-[1.25em]" />
          </Text>
          visonaut
        </Text>
        {(status === "guest" || status === "signing-in") && (
          <GuestCard
            repository={signIn.repository}
            signingIn={status === "signing-in"}
            onSignIn={signIn.signIn}
          />
        )}
        {status === "forbidden" && (
          <ForbiddenCard
            user={signIn.user}
            repository={signIn.repository}
            message={signIn.message}
            onSwitchAccount={signIn.switchAccount}
          />
        )}
        {status === "error" && (
          <ErrorCard
            message={signIn.message}
            reference={signIn.reference}
            retrying={signIn.retrying}
            onRetry={signIn.retry}
          />
        )}
      </div>
    </ShortcutsProvider>
  );
}
