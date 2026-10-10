---
"visonaut": patch
---

Submit names the screenshot that it refuses

A message about one screenshot file now starts with the item key and the variant key. The CLI prints the two keys only, and never the title of the test.

```
visonaut: dialog/open (react-light): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.
```

The message covers an image above 2.1 million pixels, a side above 8,192 pixels, a file above 2 MiB, a file that does not match its manifest, and a reference image that fails. Submit also stops before it reserves a run when two captures have the same item key and variant key:

```
visonaut: dialog/open (react-light): Two captures have this item key and variant key. Give each screenshot its own keys.
```

`A capture file changed while it was read.` now says `A capture file was modified while it was read.`
