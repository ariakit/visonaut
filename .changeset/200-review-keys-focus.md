---
"@visonaut/web": patch
---

The review page keeps its keys, focus, and layout choices

- **Stored shortcut switch.** **Shortcuts on/off** stays as the reviewer left it after a reload, and the key hints of the page hide while the shortcuts are off.
- **Skip link.** The first Tab stop is **Skip to review actions**, which moves the focus to the decision bar. The page root is no longer a Tab stop.
- **Home and End.** On a variant mark, Home selects the first variant and End the last one.
- **Narrow layout.** The page shows the list and the details in dialogs when the page is narrower than 64rem. Before, a window of 1,024 to 1,038 px with a classic scrollbar showed no list.
- **Search.** The placeholder of the screenshot search has more contrast.
