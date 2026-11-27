foliate-js (MIT, `LICENSE`), the modules the Reader's book engine uses: Readest's fork (github.com/readest/foliate-js, commit 07ef841, 2026-11-11), which carries its renderer work on top of johnfactotum/foliate-js.

Changed here: `fixed-layout.js` is left out, as the reader shows fixed pages on its own surface (`view.js` would only load it for a fixed layout book, which never reaches it); `epub.js` (at its `Curio:` comment) reads the manifest's `fallback` and puts a spine item's fallback in its place when the item isn't XHTML, HTML or SVG (W3C test `pub-foreign_xml-spine`).

`pdf.js` reads PDFs through pdf.js; changed here (at its `Curio:` comments) to find it in `../pdfjs/`, and to hand out the pdf.js document (`book.pdf`) and export its page colour helpers (`getImageRects`, `getKeptImageRects`, `applyPageColors`, `getRenderOperatorList`) for the reader's own page drawing (`kinds/pdfpage.js`).

Not copied: `comic-book.js`, `tts.js`, `dict.js`, `opds.js`, `quote-image.js`, the example reader and the UI helpers. `view.js` imports some of these only when a book needs them, which the Reader never asks for.
