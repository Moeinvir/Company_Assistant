# Persian (fa) localisation

English is the source language. In Persian mode the rendered UI is translated
from a dictionary; nothing in the components needs to change when you add text.

- `glossary.ts` — which words stay in English (Latin): API, RAG, PDF, Embedding, brand and model names…
- `fa.part*.ts` — English → Persian dictionary (exact UI strings). Edit a Persian word here.
- `engine.ts` — rules for dynamic strings ("3m ago", "12 passages", `Delete “X”?`), Persian digits and dates.
- `dom.ts` — applies the translation to text nodes / placeholders / aria-labels and restores English when you switch back.
- `legacyEn.ts` — Persian → English for the strings written directly in Persian in `KnowledgePage.tsx`.

Adding a new screen: write the English text as usual. If it shows up in English
in Persian mode, add one line `["English text", "متن فارسی"]` to a `fa.part*.ts` file.
User content (names, documents, chat messages) is only touched if it is *exactly* a dictionary key.
Text inside `<code>`, `<pre>`, inputs, or an element with `translate="no"` is never translated.
