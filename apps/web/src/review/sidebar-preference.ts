export const sidebarStorageKey = "visonaut.review.sidebar";

// The run route renders on the client. Read this in the document head so its
// first render uses the saved layout, before a sidebar can flash on screen.
export const sidebarPreferenceScript = `(() => {
  let open = true;
  try { open = localStorage.getItem(${JSON.stringify(sidebarStorageKey)}) !== "false"; } catch {}
  document.documentElement.dataset.reviewSidebarOpen = String(open);
})();`;
