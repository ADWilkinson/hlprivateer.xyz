# Local secrets (DO NOT COMMIT)

This `secrets/` directory is for **local/runtime-only** secret material.

- It is intentionally **gitignored**.
- Files in here may include database credentials and private key shards.
- Use `secrets.example/` as a template for the required filenames/format.

## Setup

1. Copy the templates:

```bash
cp -R secrets.example/* secrets/
```

2. Fill in the values locally.

## Important security note

If any secrets were ever committed to git history, removing files in a new commit is **not enough**.
You must rotate compromised credentials and rewrite history (e.g. `git filter-repo` or BFG) if you
need to fully purge them.
