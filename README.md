# Secure research-image uploads

A small full-stack app for uploading research images into private object
storage, where two hospitals share one system and neither can see anything
belonging to the other.

Hospital A uploads an image for one of its samples. Hospital B cannot view it,
download it, list it, or learn that it exists — even knowing the upload id or
the object key.

**Stack:** SvelteKit + TypeScript, Drizzle ORM + PostgreSQL, MinIO for object
storage, Vitest, Tailwind. Postgres and MinIO run in Docker.

---

## 1. Setup and run

One-time, after cloning:

```bash
npm install
```

```bash
cp .env.example .env
```

`.env.example` holds local development values that match `docker-compose.yml`.
There are no real credentials in this repository, and `.env` is gitignored.

Then, every time:

```bash
docker compose up -d
```

```bash
npm run dev
```

Open <http://localhost:5173>.

`npm run dev` runs the database migrations and the seed before starting the
server. Both are idempotent, so it is safe on every start. That is deliberate:
starting the app should not be a checklist.

The header has a switch between **Dana (Hospital A)** and **Ben (Hospital B)**.
Upload something as Dana, switch to Ben, and the list is empty. Nothing is
filtered in the browser — switching changes what the server is willing to
answer with.

To watch the `failed` state, upload with the sample ID `FAIL-TEST`. That is the
simulated processor's only knob; without it, nothing in a simulation can go
wrong, and the failure UI would be unreachable in a demo.

## 2. Starting MinIO and the database

Both are in `docker-compose.yml` and start with the `docker compose up -d`
above. Nothing needs to be clicked in any console.

| Service  | Where                                           | Credentials                             |
| -------- | ----------------------------------------------- | --------------------------------------- |
| Postgres | `localhost:5432`, database `research_uploads`   | `research` / `research`                 |
| MinIO    | `localhost:9000` (S3 API)                       | `minio-dev-user` / `minio-dev-password` |
| MinIO    | <http://localhost:9001> (web console, optional) | as above                                |

Both are bound to `127.0.0.1`, so neither is reachable from the local network.

The bucket is created programmatically the first time the app touches storage
(`ensureBucket()` in `src/lib/server/storage.ts`), so there is no manual setup
step. No bucket policy is applied: a new MinIO bucket is private by default,
and that is exactly what this app needs. Applying a public-read policy would be
the single change that breaks the whole security model.

### Looking at the data

Two places to look, matching the two things this app stores.

**The database** - tables, rows, the `uploads` record for each file:

```bash
npm run db:studio
```

Then open <https://local.drizzle.studio>. Leave the command running while you
use it; `Ctrl+C` stops it.

**The files themselves** - the actual bytes, filed under
`uploads/{company}/{upload}/`: the MinIO console at <http://localhost:9001>,
with the credentials in the table above.

Looking at both side by side is the quickest way to see the split this app is
built on: the database holds the facts, MinIO holds the bytes, and `object_key`
is the only thing joining them.

## 3. Running the tests

```bash
docker compose up -d
```

```bash
npm test
```

The type check is separate:

```bash
npm run check
```

The tests need the services running. They use their own database
(`research_uploads_test`, created by `docker/postgres-init/`) and their own
bucket, because they truncate tables between cases and must not touch the data
the running app is using. If the services are down, the suite says so in one
line rather than printing connection stack traces.

**They run against real Postgres and real MinIO, not mocks.** The things worth
proving — that a presigned policy refuses an oversized body, that an expired
URL stops working, that confirm cannot find an object that was never uploaded —
are all properties of the storage service. A mocked MinIO would only prove that
the mock agrees with my assumptions, which is the one thing not in doubt.

| File                                        | What it covers                                                      |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/server/authz.test.ts`              | the access rule itself, with plain objects                          |
| `src/lib/server/object-key.test.ts`         | filename sanitising and path traversal                              |
| `src/lib/server/validation.test.ts`         | metadata rules                                                      |
| `src/lib/server/access-control.test.ts`     | the four tests the brief requires, numbered to match                |
| `src/lib/server/upload-reliability.test.ts` | four extra tests: missing object, double confirm, traversal, expiry |
| `src/lib/server/view-and-delete.test.ts`    | the view and delete features, which are not in the brief            |

## 4. Data model

Three tables, in `src/lib/server/db/schema.ts`.

**`companies`** — `id`, `name`. Hospital A and Hospital B. This is the tenant
boundary the whole app is about.

**`users`** — `id`, `name`, `company_id`. Seeded. There is no password column
and no session table: the brief allows a development user switch instead of a
login system, and a half-built auth system would be worse than an obviously
fake one.

**`uploads`** — one row per image:

| Column                       | Why it is there                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `id` (uuid)                  | primary key, and part of the object key                                              |
| `sample_id`                  | which sample the image belongs to                                                    |
| `filename`                   | the name the user sent, kept for display and for the download filename               |
| `classification`             | `internal`, `confidential` or `restricted` — see "Questions I would raise"           |
| `company_id`                 | the owning company. **This single column is the entire access rule.**                |
| `object_key`                 | where the bytes are in MinIO. Generated server-side; never leaves the server         |
| `status`                     | `pending`, `uploaded`, `queued`, `processing`, `completed`, `failed`                 |
| `size_bytes`, `content_type` | filled at confirm time from MinIO's view of the object, not from the browser's claim |
| `failure_reason`             | shown to the user when processing fails                                              |
| `deleted_at`                 | soft delete. Null means live; a timestamp means withdrawn from the app but retained  |
| `created_at`, `updated_at`   | timestamps                                                                           |

Indexed on `(company_id, created_at)`, which is the only read pattern the app
has: every list query is scoped to one company and ordered by recency.

Note what the API response leaves out. `toUploadView()` in
`src/lib/server/responses.ts` sends neither `object_key` nor `company_id` to
the browser. The browser has no use for either — it uploads and downloads
through presigned URLs — and keeping them server-side means they cannot end up
in devtools, a screenshot, or a log.

## 5. Why metadata and bytes are stored separately

They are different kinds of data with different access patterns, and putting
them in one place makes both worse.

- **Databases are bad at bytes.** A 25 MB image in a Postgres column bloats
  every backup, every replica, and every dump. Queries that never touch the
  image still pay for it.
- **Object storage is bad at questions.** MinIO can hand back an object by key.
  It cannot answer "which uploads for sample 0142 are still processing", which
  is the only kind of question this app actually asks.
- **They scale differently.** Bytes grow without bound and are written once and
  read rarely. Metadata stays small and is queried constantly.
- **Separating them is what makes presigned URLs possible at all.** Because the
  bytes live in a service that can issue its own time-limited credentials, a
  25 MB upload never passes through the SvelteKit process. The server handles a
  small JSON request and a signature, not a file stream.

The database is the source of truth about _what exists and who owns it_. Object
storage is the source of truth about _the bytes_. The `object_key` column is
the only link between them.

## 6. Upload flow, and the presigned URL lifecycle

```
Browser                     SvelteKit                        MinIO
   |                            |                              |
   |-- POST /api/uploads ------>|                              |
   |    metadata only           | validate                     |
   |                            | id = randomUUID()            |
   |                            | key = uploads/{co}/{id}/{f}  |
   |                            | INSERT status='pending'      |
   |                            |-- sign POST policy --------->|
   |<-- 201 {upload, presigned}-|                              |
   |                                                           |
   |-- POST multipart, the actual bytes ---------------------->|
   |<-- 204 -------------------------------------------------- |
   |                            |                              |
   |-- POST /api/uploads/{id}/confirm ->|                       |
   |                            | look up record               |
   |                            | canAccess() or 404           |
   |                            | key comes from the record    |
   |                            |-- statObject(key) ---------->|
   |                            |<-- size, content-type -------|
   |                            | UPDATE status='uploaded'     |
   |<-- 200 {upload} -----------|                              |
   |                            | queued -> processing -> completed
```

**Why the record is created first.** The object key contains the upload id, so
the row has to exist before the browser can be told where to put the bytes.
That is why there is a `pending` status — see "Questions I would raise".

**What the presigned URL allows.** It is a POST policy, not a plain presigned
PUT. A PUT signature says "you may write to this key"; it cannot constrain how
much you write. A POST policy signs the _conditions_, so MinIO enforces them
itself, before the app is involved:

| Condition      | Value                                   | Why                                          |
| -------------- | --------------------------------------- | -------------------------------------------- |
| key            | exactly one key, not a prefix           | the browser cannot choose where bytes land   |
| content-type   | `image/png`, `image/jpeg`, `image/tiff` | an allowlist, not a blocklist                |
| content-length | 1 byte to 25 MB                         | a stolen URL cannot be used to fill the disk |
| expiry         | 5 minutes                               | see section 10                               |

Whoever holds that URL can upload **one object, at one key, of one type, under
the size limit, for five minutes**. Then it is worthless.

**Why confirm exists.** The server never sees the bytes, so it has to ask
storage whether they arrived. Confirm looks up the record, derives the key from
it, and calls `statObject`. Nothing in the request body is used — a key
supplied by the browser would let a caller point a confirm at somebody else's
object, so there is no code path that accepts one.

**Confirm is idempotent.** It is an ordinary network call: the browser retries,
proxies repeat, users click twice. Only a `pending` record is advanced, and the
update carries `WHERE status = 'pending'`, so the check and the write are one
statement and two racing confirms cannot both move the record. A record that
has already moved on is returned as it is, never dragged backwards.

If the object is not there, the record stays `pending` rather than becoming
`failed`, because that case is retryable — the user can pick the file again
and upload against a fresh URL. `failed` is reserved for work that was
attempted and did not succeed.

## 7. Download flow and server-side authorization

```
Browser --- GET /api/uploads/{id}/download ---> SvelteKit
                                                 |
                                     requireAccessibleUpload()
                                       - is this a uuid?
                                       - does the row exist?
                                       - canAccess(actor, row)?
                                                 |
                                     any failure -> 404, identical body
                                                 |
                                     presignedGetObject(key, 60s)
Browser <-- 200 { url, expiresInSeconds } -------|
Browser --- GET that url ---------------------> MinIO --> bytes
```

The order is the whole requirement: **authorize first, sign second.**
`createPresignedDownload()` has no idea who is asking and would sign whatever
it is handed. That is precisely why it is unreachable without going through the
authorization check first.

The object key is read off the record, so knowing a key is worth nothing. A
caller can only ask by upload id, and only ever gets an answer for an upload
their own company owns.

**The decision lives in one function**, `canAccess(actor, record)` in
`src/lib/server/authz.ts`:

```ts
export function canAccess(actor: Actor | null, record: OwnedRecord | null): boolean {
	if (!actor || !record) return false;
	return actor.companyId === record.companyId;
}
```

No database, no storage client, no framework types. Every route calls it; none
reimplement it. It fails closed on a missing record as well as a missing actor,
which is what lets every route treat "does not exist" and "not yours" as the
same answer.

**The list route is the one place that also filters in SQL**, because a list
cannot ask a yes/no question per row without fetching the whole table first.
The query narrows and `canAccess` still decides: every row is passed through it
before it leaves the server, so if the two ever disagreed, the function wins.

## 8. Why presigned URLs are safer than exposing MinIO credentials

The root credentials open the whole bucket, forever, for every operation. They
can read any object, write any object, delete any object, and list everything
in it. Handing those to a browser means:

- they are in JavaScript the user can read, so anyone who opens devtools has
  them;
- they are as good as a copy of the entire bucket, including Hospital A's
  images while Hospital B is looking at them;
- the listing permission alone breaks the brief — Hospital B could enumerate
  keys and learn what Hospital A has uploaded and when;
- revoking them means rotating the credential for every user at once;
- they never expire on their own.

A presigned URL is a signature over a specific, narrow statement: _this
operation, on this object, with these conditions, until this moment._ It grants
one action instead of an account. It cannot list. It expires by itself with
nothing to revoke. And because the signature is generated with credentials the
browser never sees, a leaked URL discloses one object for a few minutes rather
than the keys to everything.

## 9. Why presigned URLs do not replace application authorization

A presigned URL answers "is this request correctly signed and still in date?".
It does not answer "should this person have been given it?" — that question was
settled at the moment of signing, and storage has no idea what the answer was.

MinIO does not know that Hospital B exists. It cannot tell that the caller
asking for `uploads/hospital-a/.../scan.png` works somewhere else, because the
signature says the request is legitimate and the signature is all it has. The
tenant model lives entirely in the database, and the only place it is applied
is the application.

So the URL is the _mechanism_ and `canAccess` is the _policy_. Confusing the
two would mean any caller who could reach the download route could get a
perfectly valid URL for anyone's object — correctly signed, cryptographically
sound, and completely wrong.

This is also why the object key prefix (`uploads/{company-id}/{upload-id}/...`)
is a naming convention and not a security boundary. It makes keys tidy and
auditable, and it is what a future bucket policy or per-tenant lifecycle rule
would key on. Nothing in this app trusts it to keep anyone out.

## 10. Chosen URL expiry, and why

| URL      | Expiry     | Reasoning                                                                                                                                                        |
| -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload   | 5 minutes  | It has to cover the whole transfer. 25 MB on a slow hospital connection is a couple of minutes, so five leaves room without leaving a writable URL lying about.  |
| Download | 60 seconds | The browser follows it immediately, so it only has to survive one round trip. A URL that leaks into a log, a screenshot, or a chat message is stale in a minute. |

The two differ because the risk is different in each direction. An upload URL
must outlive a slow transfer, which sets a floor on how short it can be. A
download URL is used the instant it is issued, so it can be much shorter — and
it should be, because it points at data that already exists.

Both deadlines are inside the signature, so MinIO enforces them and nothing in
this app is consulted. `upload-reliability.test.ts` proves it, by signing a URL
with a one-second life and asserting it is refused afterwards.

## 11. How production image processing would use a queue and a worker

What is here now is a chain of `setTimeout` calls in the web process
(`src/lib/server/processing.ts`). The brief permits simulating it. It is
honestly not production-shaped, and the ways it falls short are the reasons the
real design looks the way it does:

- it dies with the process — restart the server mid-pipeline and a record is
  stranded in `processing` forever, with nothing to retry it;
- it does not know about other server instances, so it cannot be scaled;
- there is no backpressure — a thousand uploads start a thousand timers;
- CPU-heavy image work would compete with serving requests.

**In production**, confirm would do exactly what it does now — verify the
object and set `uploaded` — and then enqueue a job carrying the upload id, and
nothing else. Not the key, not the metadata: the worker re-reads those from the
database, so the job stays valid if the record changes.

A separate worker process consumes the queue: sets `processing`, streams the
object from MinIO, does the work, writes results back, sets `completed`. It
scales by running more workers, independently of the web tier.

The parts that matter beyond the happy path:

- **The queue owns retries.** A crashed worker means the job becomes visible
  again after a visibility timeout, and another worker takes it. That is the
  property `setTimeout` cannot have.
- **Jobs must be idempotent**, because at-least-once delivery means the same
  job will sometimes run twice. The same `WHERE status = ...` guard used in
  confirm applies: a conditional update, so a repeated job cannot double-write
  or move a record backwards.
- **A dead-letter queue** after N attempts, so poison jobs stop cycling and
  become visible instead of invisible. That is what sets `failed` with a real
  reason.
- **`processing` needs a timeout.** A record that has been processing for an
  hour is stuck, and something has to notice — otherwise the state means
  "started" rather than "in progress".

For this stack I would reach for Postgres itself first — `SELECT ... FOR UPDATE
SKIP LOCKED` is a genuinely good queue up to a few thousand jobs a minute, and
it adds no new infrastructure to run or reason about. Redis/BullMQ or SQS only
once the volume or the retry semantics actually justified a second system.

## 12. What I would improve next for production

Roughly in the order I would do them:

1. **Real authentication and sessions.** The dev user switch is the one piece
   that is deliberately fake. It is isolated in `hooks.server.ts` and
   `dev-user.ts` precisely so that swapping it changes those files and nothing
   else — every route already reads a server-resolved actor.
2. **Move the abandoned-upload sweep off the read path.** A tab closed
   mid-upload leaves a record at `pending` with no object behind it.
   `expireStalePendingUploads()` now fails those once the presigned URL could
   no longer possibly work, but it runs on the list request because this app
   has no scheduler. In production it belongs in a scheduled job, alongside a
   bucket lifecycle rule to drop the orphaned objects it leaves in storage.
3. **Verify file content, not just the declared type.** The policy enforces the
   content type the browser _claimed_. Reading magic bytes server-side at
   confirm time would catch a file that is not the image it says it is.
4. **An audit log.** In a hospital setting, who downloaded what and when is
   likely a compliance requirement, not a nice-to-have. Every signature issued
   should be a row.
5. **Rate limiting on the signing routes.** Nothing currently stops a client
   requesting thousands of upload URLs and creating thousands of pending rows.
6. **Server-side encryption at rest**, and TLS between the app and MinIO. Local
   development runs over plain HTTP.
7. **Structured logging with a request id**, so a failed upload can be traced
   across the create, send and confirm steps.
8. **Observability on the queue** once it exists — queue depth, job age, and a
   count of records stuck in non-terminal states.

## 13. AI tools and models used

**Tools used**

- **Claude Code (Claude Opus)** — wrote most of the implementation, the tests
  and this README, working from a brief I wrote specifying the stack, the
  constraints and the standard for comments. I drove it, reviewed the output,
  and asked for changes where I disagreed or did not follow something.

I am being direct about that because the alternative — implying I typed every
line — is the kind of claim that falls apart in a walkthrough. What follows is
the part that is mine.

**What I did myself**

- Chose the stack. SvelteKit, Drizzle and PostgreSQL because I have already
  shipped a production app on them, so I can defend the choice rather than
  having picked whatever looked impressive.
- Decided delete should be a **soft delete**. The first version removed the row
  and the object outright; I changed it, because a hospital's retention and
  audit obligations outlive one user's decision to delete, and the user cannot
  restore it either way.
- Asked for the view and delete features, and for the confirmation dialog
  wording, after the original submission scope was working.
- Asked for the debug tracing, then had it kept to the server terminal once it
  was clear that putting it in a response would be the exact leak the 404 rule
  exists to prevent.
- Pushed back on the code comments. They had grown into paragraphs; I had them
  cut back to the reasoning that is not visible from the code.
- Ruled out swapping the local Postgres for Supabase after checking the brief,
  which names the stack and says not to substitute.

**What I personally verified**

- Ran the whole thing from cold: Docker Desktop, `docker compose up -d`,
  `npm run dev`, on my own machine from a terminal in Cursor.
- Uploaded real images through the UI **as both hospitals** — the records under
  sample IDs `1234`, `8956`, `678`, `test1` and `test2` are mine. Switched
  users and confirmed each hospital sees only its own.
- Took a Hospital A upload id, switched to Ben, and requested
  `/api/uploads/{id}` and `/api/uploads/{id}/download` straight from the
  address bar, bypassing the UI entirely. Both returned
  `{"message":"Upload not found."}`, identical to a made-up id.
- Watched the upload in DevTools → Network and confirmed the file goes to
  `localhost:9000` (MinIO) while only small JSON requests go to
  `localhost:5173` (the app).
- Throttled the connection to 3G in DevTools and watched the progress bar climb
  on a real upload, to check the percentage is measuring bytes rather than
  being animated.
- **Refreshed the page mid-upload on purpose to see what would break.** It
  found two real bugs: the record sat at `pending` for good, and the page
  polled it forever. Both were fixed afterwards, and the abandoned upload now
  resolves to `failed` once its URL could no longer work.
- Noticed the Download button was still offered on a record whose bytes never
  arrived, which led to gating view and download on whether a file actually
  exists rather than on the status.
- Edited a line in `+layout.svelte` and watched the browser update without a
  reload, to understand what the dev server is doing.
- Ran `npm test` with the services up — 44 passing — and `npm run check` — no
  type errors.

---

## Beyond the brief

Everything below was added deliberately. None of it was in the employer's spec.

| #   | Addition                                                                                      | Why                                                                                                           |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | **404, never 403**, on every route keyed by an id, with identical bodies                      | A 403 confirms the resource exists, which lets Hospital B enumerate Hospital A's uploads.                     |
| 2   | **Constrained upload URLs** — size and content-type signed into a POST policy                 | An unconstrained presigned PUT lets whoever holds it upload anything, of any size.                            |
| 3   | **A defined `safe-filename`** — normalise, strip separators, allowlist characters, cap length | The spec writes `{safe-filename}` without saying what makes one safe.                                         |
| 4   | **Confirm derives the key from the record**, never from the request                           | Accepting a key from the browser would let a caller confirm against somebody else's object.                   |
| 5   | **Real byte progress**, and indeterminate states where nothing is measurable                  | A progress bar that is not measuring anything is a lie told to the user.                                      |
| 6   | **Human-readable status text**; enum values unchanged in the database and API                 | `queued` is not a sentence. What the user needs is what is happening and what they can do next.               |
| 7   | **Empty state and initial loading state**                                                     | A blank list is ambiguous — it could be empty, loading, or broken.                                            |
| 8   | **Named the `pending` state the spec omits**, and flagged it                                  | The record must exist before the bytes do. See "Questions I would raise".                                     |
| 9   | **Confirm is idempotent**, enforced by a conditional update and covered by a test             | It is a network call. Browsers retry, proxies repeat, users double-click.                                     |
| 10  | **Authorization isolated as one pure function**                                               | So there is exactly one place to point at, test, and change.                                                  |
| 11  | **Four extra tests** — missing object, double confirm, path traversal, expired URL            | Each covers a place where the happy path is not the whole story.                                              |
| 12  | **One-command startup**, both users seeded, bucket created on boot                            | A reviewer has fifteen minutes and should not spend them clicking through a MinIO console.                    |
| 13  | **`FAIL-TEST` sample id triggers a simulated failure**                                        | Otherwise the `failed` status and its UI are unreachable in a demo, since nothing in a simulation goes wrong. |
| 14  | **Two tabs instead of one long page**                                                         | Presentation only, on a single route. Not pagination, which the brief rules out.                              |
| 15  | **View** - opens the image in a modal from a short-lived inline URL                           | Same authorization and the same direct browser-to-MinIO path as download; only the disposition differs.       |
| 16  | **Delete** - soft delete, behind a confirmation dialog                                        | The first destructive route, so the shared authorization check now protects data rather than only privacy.    |

## Viewing and deleting

Neither is in the brief. Both go through the same `requireAccessibleUpload()`
as everything else, so neither needed a new access rule - which was the point
of putting the rule in one place.

**View** signs a short-lived URL exactly like download, with one difference:
`inline` rather than `attachment`, so the browser renders the image instead of
saving it. The bytes still go straight from MinIO to the browser. Proxying them
through the app would have been the alternative, and would have put every scan
through the server on every view - the thing the whole design avoids.

**Delete is a soft delete.** `deleted_at` is stamped; the row and the object
are both kept. In a hospital, retention and audit obligations usually outlive
one user's decision to delete, so "delete" here means withdrawn from the
application rather than destroyed. Nothing in the app can restore it - there is
no undelete route and no UI for one - so the warning the user confirms is
accurate.

The risk soft delete introduces is a query that forgets it and serves a deleted
row. That is contained by there being exactly two places that read uploads:
`requireAccessibleUpload()` for single records, and the list query. A deleted
record answers 404 on every id-keyed route, including for the company that owns
it - there is no back door for the owner.

Delete is also the first destructive route in the app. That raises the stakes
on the shared authorization check rather than lowering them: a wrong answer now
loses somebody's data rather than merely showing it to the wrong person. It
gets the same check as every other route, because there is only one.

## Development tracing

Set `DEBUG_AUTHZ=true` in `.env` and every authorization decision, signed URL
and validation failure prints to the terminal running the app:

```
[authz] GET /api/uploads/0cc9f0c1.../download  actor=Dana (Hospital A)  company=000a
[authz] upload=ea73  actor.company=000a  record.company=000a  canAccess=true   deleted=false  -> allow (owner)
[sign]  download  key=uploads/...000a/0cc9f0c1.../<filename>  ttl=60s

[authz] GET /api/uploads/0cc9f0c1...  actor=Ben (Hospital B)  company=000b
[authz] upload=ea73  actor.company=000b  record.company=000a  canAccess=false  deleted=false  -> 404 (different company)
```

Two decisions in that output are deliberate.

**It goes to the terminal, never into a response.** A debug flag that made a
refusal explain itself - "this record belongs to Hospital A" - would be exactly
the leak the 404 rule exists to prevent, sitting one environment variable away
from production. With the flag on or off, the bytes the browser receives are
identical; only the operator's terminal changes.

**Filenames and sample ids are never logged.** An object key ends in the user's
filename, and in a hospital a filename can identify a patient. Logs get
shipped, searched and retained far longer than anyone intends, so the trace
keeps only the structural part of the key - which company, which upload - which
is all the decision turned on anyway.

## Questions I would raise

Two places where the brief is genuinely ambiguous. I made a choice in both and
am flagging it rather than deviating quietly.

**1. The status list has no name for "record created, bytes not uploaded yet".**

The brief lists `uploaded`, `queued`, `processing`, `completed`, `failed`. But
the object key contains the upload id, so the row must exist _before_ the
browser can be told where to send the bytes. That leaves a real state the list
does not name.

I added `pending` for it. Without it, a row would have to claim `uploaded`
while nothing had been uploaded, and an abandoned upload would be
indistinguishable from a successful one.

The alternative was to let the browser influence the key — generating the id
client-side, or using a random key that is not the id — so the row could be
written after the upload instead. That trades a clear state machine for a key
the browser has a hand in choosing, which the security requirements rule out.

**Question for the team:** is `pending` the right name, or does an existing
convention cover this state?

**2. `classification` is required but never defined.**

The brief lists it as a metadata field without saying what it holds. It could
be the sensitivity of the data, or a clinical category of the image, or a
processing pipeline selector.

I read it as sensitivity — `internal`, `confidential`, `restricted` — because
this is a hospital data-sharing scenario and the rest of the brief is about
access control. It is currently stored and displayed but does not affect
authorization.

**Question for the team:** is classification meant to _do_ anything? If
`restricted` should mean shorter URL expiry, a narrower audience inside the
owning hospital, or mandatory audit logging, that changes the model — it would
stop being a label and become a second input to `canAccess`.

---

## Where the important code is

For a walkthrough, in the order it makes sense to read:

| Path                                              | What it is                                                  |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `src/lib/server/authz.ts`                         | **the access rule.** Start here                             |
| `src/lib/server/db/schema.ts`                     | the data model, and the note on the added `pending` status  |
| `src/lib/server/load-upload.ts`                   | look up, authorize, or 404 — shared by every id-keyed route |
| `src/routes/api/uploads/+server.ts`               | create the record and sign the upload URL; list             |
| `src/routes/api/uploads/[id]/confirm/+server.ts`  | verify the bytes arrived; idempotent                        |
| `src/routes/api/uploads/[id]/download/+server.ts` | authorize, then sign                                        |
| `src/lib/server/storage.ts`                       | the only file that holds MinIO credentials                  |
| `src/lib/server/object-key.ts`                    | filename sanitising and key construction                    |
| `src/lib/upload-client.ts`                        | the browser half: create, send bytes, confirm               |
| `src/lib/server/processing.ts`                    | simulated pipeline, with its limitations written down       |
