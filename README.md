# Drive Class Organizer

A web app that scans a connected Google Drive, figures out which **class**
(course or subject) each file belongs to using Claude, and lets you review
and apply a plan that files everything into per-class folders. Nothing is
moved until you click **Apply**.

## How it works

1. Sign in with Google (grants full Drive access — needed to move files you
   already have, not just files this app creates).
2. **Scan**: lists every file in your My Drive, pulls a text excerpt from
   each one it can read (Google Docs/Slides/Sheets via export, PDFs via
   `pdf-parse`, plain text/markdown/CSV directly), and skips already-organized
   files from a previous run.
3. **Classify**: batches files to Claude, which proposes a class/category
   name per file plus a confidence score, then runs a second pass to merge
   near-duplicate labels (e.g. "Bio 101" and "Biology 101") into one
   canonical folder name.
4. **Review**: an editable, grouped-by-class plan — rename any file's class,
   or uncheck it to leave it where it is. Nothing moves yet.
5. **Apply**: creates one subfolder per class under a root folder (default
   "Organized by Class") in your My Drive and moves each included file into
   it.

Every scan is a background job you can poll for progress; job state is kept
in memory and mirrored to `data/jobs/*.json` so history survives a server
restart.

## Requirements

- Node.js 18.18+ (Next.js 15)
- A Google Cloud project with the Drive API enabled and an OAuth client
- An Anthropic API key

**Deployment note:** scanning/classifying/moving runs as a background task
inside the same long-lived Node process that served the request. This works
with `next start` on a normal server/VM/container, but **not** on serverless
platforms (e.g. Vercel functions) that suspend the process after the
response is sent — a long scan would be killed mid-job there.

## 1. Google Cloud setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **APIs & Services → Library** → enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External (or Internal if you're on Google Workspace).
   - Add yourself as a test user if the app stays in "Testing" mode (fine
     for personal use — no Google verification review needed as long as
     only test users sign in).
   - Scopes: you don't need to add `.../auth/drive` here manually; it's
     requested at runtime, but you can add it if the consent screen asks.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
     (swap the host/port for your deployed URL in production, e.g.
     `https://your-domain.com/api/auth/callback/google`).
   - Save the generated **Client ID** and **Client Secret**.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...        # generate with: openssl rand -base64 32

ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-opus-5 # optional override

ORGANIZE_ROOT_FOLDER_NAME=Organized by Class  # optional default
```

## 3. Run it

```bash
npm install
npm run dev     # http://localhost:3000

# production
npm run build
npm start
```

## Notes & limitations

- Only files you own in **My Drive** are scanned (not Shared Drives or
  files shared *with* you) — this keeps the "move" operation unambiguous.
- Files whose content can't be extracted (images, videos, unfamiliar binary
  formats) are still classified, but from filename/type alone, with lower
  confidence — flagged as "(filename only)" in the review table.
- Re-running a scan automatically excludes anything already inside the
  organize root folder from a previous apply, so repeated scans don't try
  to re-sort already-sorted files.
- Moving a file changes its parent folder in Drive; it does not create a
  copy.
