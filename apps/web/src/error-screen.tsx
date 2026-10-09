// The one error screen of the app. A failed route or a failed load of a part
// of the app shows it. It imports no component and no route, so it needs no
// other chunk: the chunk that failed to load can be the cause.

import { createContext, useContext } from "react";

/**
 * True below the shell of the layout route. The router shows the error screen
 * in the place of the route that failed, so the screen is below that shell
 * when a page failed, and it has no shell when the layout route itself failed.
 */
export const InsideShellContext = createContext(false);

/** The app header when no shell has one, one sentence, and Reload. */
export function ErrorScreen() {
  const insideShell = useContext(InsideShellContext);
  const message = (
    <main className="col-span-full mx-auto grid w-full max-w-xl justify-items-start gap-4 px-4 py-8 sm:py-16">
      {/* React moves a title element to the head of the document. */}
      <title>Error · Visonaut</title>
      <h1 className="text-2xl font-semibold tracking-tight">This page could not be shown</h1>
      <p role="alert" className="ak-ink-60">
        A part of Visonaut did not load or did not work. Reload the page to try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="ak-layer-brand rounded-lg px-4 py-2 font-medium"
      >
        Reload
      </button>
    </main>
  );
  if (insideShell) return message;
  return (
    <div className="ak-layer-canvas min-h-dvh text-sm">
      <header className="flex h-12 items-center px-4">
        <a href="/" className="font-semibold">
          visonaut
        </a>
      </header>
      {message}
    </div>
  );
}
