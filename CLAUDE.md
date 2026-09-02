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

PWA `name` and `short_name` fields in `manifest.json` must always start with `@` (e.g. `"@My App"`). This makes them sort to the top of the Android share-with app list.

## Privacy

This is a **public repository**. Never commit or push personally identifiable information — no real names, email addresses, phone numbers, API keys, tokens, credentials, or any other private data.

## Service workers: bumping the version is necessary but not sufficient

Any project with a `sw.js` must still have its cache version constant (e.g.
`vb-v1`) incremented on **every commit** that changes a cached file (HTML, JS,
CSS, manifest, icons). User data in `localStorage` is unaffected by cache
version changes.

**But that bump alone does not make an installed PWA show the new build.** It
only decides which cache the *next* worker fills and which old ones it deletes.
Two further things are required, and without them the app serves a stale page
indefinitely while looking, from the outside, like the deploy failed:

1. **Navigations must be network-first.** A cache-first navigation handler
   (`caches.match('./index.html')` first) never asks the network for HTML, so
   once a copy is cached it is answered from cache forever. The cache should be
   the offline fallback, not the default answer.

2. **The page must reload itself when a new worker takes over.** `skipWaiting()`
   plus `clients.claim()` transfers control but does **not** reload the
   document — the old HTML and old JS stay on screen. A standalone PWA reopened
   from the home screen usually resumes the existing document rather than
   navigating, so nothing triggers that reload on its own. Listen for
   `controllerchange` and `location.reload()` once, guarded on there having been
   a previous controller (without that guard a first install reload-loops), and
   call `registration.update()` on `visibilitychange` as well as on load, since
   resuming a backgrounded PWA is not a navigation.

Measured 2026-09-02 with a real worker over localhost and a persistent browser
profile, deploying new content *and* a bumped cache version between opens:

    cache-first     1st open   sees OLD   caches=[v4]
                    2nd open   sees OLD   caches=[v4,v9]   <- new cache built, page still stale
                    3rd open   sees NEW   caches=[v9]

    network-first   1st open   sees OLD   caches=[v5]
                    2nd open   sees NEW   caches=[v5,v9]   <- fresh immediately

The second cache-first line is the whole point: the new files had already been
downloaded and cached, and the user still saw the old build. That is what "I
bumped the version but it didn't update" actually looks like.

All ten PWAs here (`arabic`, `audio-transcribe`, `chat`, `council`,
`death-jester`, `putzplan`, `share`, `url-opener`, `utilities`, `voice-blocks`)
were converted to this pattern on 2026-09-02. Copy any of their `sw.js` fetch
handlers and registration blocks when adding a new one. `council/` additionally
consults its own in-flight flag before reloading; the rest use the generic rule
above (reload at once if the page just loaded or is hidden, otherwise wait until
it is next hidden), which is enough to protect a recording or an upload.

Two traps found while doing this, both silent:

- **`cache.addAll()` rejects atomically.** One missing file in the asset list
  fails the whole install, so the worker never activates and the app simply has
  no offline support — with no error anywhere. Check every path in the list
  exists before shipping.
- **`chat/index.html` contains deliberate NUL bytes** (sentinel markers in its
  markdown renderer). `grep` treats the file as binary and silently reports
  nothing, which is how it was first mistaken for having no service worker at
  all. Use `python3` rather than `grep` when auditing that file.

Finally: a fix cannot reach an already-installed old worker retroactively. The
first upgrade past a cache-first worker still takes the old multi-open path. Tell
the user that rather than claiming the update will be instant.
