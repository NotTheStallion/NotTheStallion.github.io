# The Stallion

Personal site: what I build, what I'm learning, what I'm reading.
Live at <https://notthestallion.github.io/>.

Plain HTML, CSS and JavaScript modules. No build step, no dependencies.

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` straight from disk won't work: the page fetches its JSON files.

## Update the content

Most changes are a JSON edit. No code to touch.

| What | File | Shape |
|---|---|---|
| Books | `books.json` | `{ "title", "author", "isbn", "shelf": "reading" \| "read" \| "want", "take"? }` |
| Learning topics | `learning.json` → `topics` | `{ "name", "why", "status": "started" \| "deep" \| "wrapping-up" \| "learned", "resources": [...] }` |
| Finished topics | `learning.json` → `learned` | `{ "name", "why" }`, or set a topic's status to `"learned"` |
| On the radar | `learning.json` → `radar` | `{ "topic", "hook", "links": [up to 3 URLs] }` |
| Projects | `js/workbench.js` → `PROJECTS` | GitHub stars show automatically once a repo passes 5 |

Covers come from Open Library by ISBN. If a cover is wrong or missing, try another
edition's ISBN, or add `"cover": "<image URL>"` to the book.

A resource in `learning.json` is either a book, `{ "isbn": "..." }` (it must also be
in `books.json`), or a link, `{ "name": "...", "url": "https://..." }`.

## Notes

Chapter notes for books and courses, rendered with Markdown and KaTeX by `notes.html`.

1. Write `notes/<resource-id>/<nn>-<slug>.md`. The resource id is the book's ISBN,
   or a short id you choose for a course. Write maths as `$...$` or `$$...$$`.
2. Register it in `notes/index.json`:

```json
{
  "resources": {
    "9781108455145": {
      "kind": "book",
      "title": "Mathematics for Machine Learning",
      "chapters": [{ "n": "02", "slug": "linear-algebra", "title": "Linear Algebra" }]
    }
  }
}
```

The footer's Notes link and the ✎ Notes badges on learning topics appear by themselves
once a resource has notes.

## Tests

```sh
node --test tests/*.mjs
```

## Licence

Code: MIT. Notes: CC BY 4.0. The logo and third-party media keep their own terms.
See [LICENSE](LICENSE).
