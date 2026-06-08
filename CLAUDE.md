# publicweb

## Git workflow

After implementing any change, merge into `main` and push:

```bash
git checkout main
git merge --ff-only <feature-branch>
git push -u origin main
```

## Adding new projects

New projects must always be added as the **first entry** in the `<ul>` in `index.html`.

## Service worker versioning

Any project with a `sw.js` must have its cache version constant (e.g. `vb-v1`) incremented on **every commit** that changes any cached file (HTML, JS, CSS, manifest, icons). This ensures installed PWAs pick up the new files immediately. User data in `localStorage` is unaffected by cache version changes.
