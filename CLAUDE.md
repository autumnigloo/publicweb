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
