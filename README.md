# HR Assist — an agentic HR chat assistant

HR Assist answers employees' leave and HR-policy questions, files and cancels leave requests for them, and
lets managers review and approve their team's leave. It is a **LangGraph.js agent** running on
**Claude Haiku 4.5**. The agent looks up the user's own records, searches the policy documents (citing them),
does leave arithmetic in deterministic code, and asks the user to confirm before it writes anything.

> All data in this project is **synthetic**: fictional company (Acme Corp), fictional employees, sample
> policies. No real HR or personal data is used.

**Stack:** TypeScript end to end · LangGraph.js · LangChain (Anthropic) · Express · SQLite (better-sqlite3) ·
React 19 + MUI · Vite · LangSmith tracing

📄 **Architecture & design document (PDF):** [docs/HR-Assist-Architecture.pdf](docs/HR-Assist-Architecture.pdf)

---

## What it can do

| Ask | What the agent does |
|---|---|
| "What's my leave balance?" | One tool call → balances per leave type |
| "Can I take Dec 22 to Jan 2 off?" | Resolves the year, counts **working days** (skips weekends and the office's holidays), checks the balance and the leave type's policy rules, reports loss of pay if any |
| "How many earned leave days can I carry forward?" | Searches the policy documents and answers with a citation, e.g. *(Leave Policy §4)* |
| "What is the bereavement leave policy?" | Says the policy documents don't cover it instead of guessing |
| "What about sick leave instead?" | Uses conversation memory for the follow-up |
| "Apply for earned leave from Dec 22 to Jan 2" | Validates the request in code, **pauses for confirmation**, writes it only after the user clicks Submit |
| "Cancel my leave on Oct 16" | Finds the request, checks it can still be cancelled, **pauses for confirmation**, then cancels it and returns the days to the balance |
| "What is Dev Patel's leave balance?" | Refuses: users can only see their own data |
| *Manager:* "Any leave requests waiting for my approval?" | Lists direct reports' pending requests |
| *Manager:* "Approve request #4" | **Pauses for confirmation**, then approves (or rejects) — only for direct reports |
| *Manager:* "Who on my team is on leave next month?" | Team leave calendar for direct reports |

---

## Quick start

**Prerequisites:** Node.js 22.12 or newer (developed on Node 25), an [Anthropic API key](https://console.anthropic.com).

```bash
npm run setup                          # installs root, server and client dependencies; seeds the database
cp server/.env.example server/.env     # Windows: copy server\.env.example server\.env
```

Edit `server/.env`:

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude key |
| `JWT_SECRET` | yes | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `LLM_PROVIDER` / `LLM_MODEL` | no | Defaults to `anthropic` / `claude-haiku-4-5`. `google` + `GOOGLE_API_KEY` switches to Gemini |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | no | Turns on LangSmith traces of every model and tool call |
| `APP_TODAY` | no | Pin "today" (YYYY-MM-DD) for reproducible demos |
| `POLICY_DIR` | no | Folder of policy documents (.md/.txt/.pdf/.docx); default `server/policies` (see below) |

```bash
npm run dev          # API on :3001 and UI on :5173 together
```

Open http://localhost:5173 and pick a demo account (password for all: `Password@123`):

| Account | Why it's interesting |
|---|---|
| `asha.rao@example.com` | Main demo user (Chennai): leave history, a pending request |
| `dev.patel@example.com` | Bengaluru office: different regional holidays |
| `priya.nair@example.com` | Joined Jul 2026: pro-rated quota, not yet eligible for earned leave |
| `ravi.kumar@example.com` | Manager of the other three: team leave view and approvals |

### Using your own policy documents

Policy search reads every `.md`, `.txt`, `.pdf` and `.docx` file in `server/policies/` (fictional samples by
default) at startup. To use other documents, for example ones provided by your HR team, put them in
`server/policies-private/` (gitignored, so they never reach the repository) and set `POLICY_DIR=./policies-private`
in `server/.env`. Documents are split into sections by their headings: Word heading styles, Markdown `##` headings,
or numbered/capitalised heading lines in PDF and text files; long sections are split into parts. Answers cite
`Document §Section`. Check how a folder was split with:

```bash
cd server && npm run policies -- --search "carry forward"
```

The leave quotas and rules enforced in code (`leave_types` seed data and `server/src/hr/leaveRequest.ts`) mirror the
sample Leave Policy; update them if your policy's numbers differ.

Other scripts (from the project root): `npm test` (unit/integration tests, no LLM calls), `npm run eval`
(evaluation against the real model), `npm run typecheck`, `npm run db:reset` (restore the demo data).
In `server/`: `npm run chat` (terminal chat; `-- --as E1000` to switch user), `npm run graph` (print the agent
graph as Mermaid). `npm run dev` first stops leftover dev servers of this project still holding ports 3001/5173.

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI["React + MUI chat UI<br/>login · chat · confirmation card"]
  end

  subgraph Server["Express API (Node.js)"]
    Auth["JWT auth<br/>employeeId from verified token only"]
    Runner["Turn runner<br/>thread = employeeId:threadId"]
    subgraph Agent["LangGraph agent"]
      Graph["StateGraph<br/>agent ⇄ tools → trim"]
      CP[("MemorySaver<br/>checkpointer")]
    end
    Tools["9 tools + 3 manager tools"]
    Math["Leave math + validation<br/>(pure, unit-tested)"]
    RAG["BM25 policy search"]
  end

  Claude["Claude Haiku 4.5<br/>(Anthropic API)"]
  DB[("SQLite<br/>synthetic HR data")]
  Docs["policies/*.md"]
  LS["LangSmith<br/>tracing"]

  UI -- "/api/login · /api/chat · /api/chat/confirm" --> Auth
  Auth --> Runner --> Graph
  Graph <--> CP
  Graph -- "prompt + tool schemas" --> Claude
  Graph --> Tools
  Tools --> Math
  Tools --> DB
  Tools --> RAG
  RAG --> Docs
  Graph -. traces .-> LS
```

### The agent graph

```mermaid
graph TD;
  START([Start]) --> agent;
  agent -.->|tool calls| tools;
  tools --> agent;
  agent -.->|final answer| trim;
  trim --> FINISH([End]);
```

- **agent**: calls Claude with a short system prompt (added per call, not stored) and the conversation.
- **tools**: LangGraph's `ToolNode` runs every tool the model asked for, in parallel, and returns errors to the
  model as messages so it can correct itself (e.g. a bad date).
- **trim**: once a turn is answered, removes its tool calls/results and keeps only the last 4 question/answer
  pairs. Saves tokens on every later turn.
- **State** = `messages` + `employeeId`. The checkpointer saves state after every step under the thread ID: that is
  the conversation memory, and it is what lets a run pause and resume.

### Tools

| Tool | Purpose |
|---|---|
| `get_employee_profile` | Grade, department, location, joining date, tenure, manager |
| `get_leave_balance` | Allocated, carried forward, used, pending, available per leave type |
| `get_leave_history` | The user's requests in a date range |
| `get_holidays` | Holiday calendar for a year and office |
| `calculate_leave` | Working days in a range (weekends + office holidays excluded), loss of pay, balance after, pro-rata entitlement, encashment |
| `check_eligibility` | Tenure and balance check for a leave type |
| `search_policy` | Keyword search over the policy documents; returns sections with citation labels |
| `apply_leave` | Validates, asks the user to confirm (interrupt), then writes a pending request |
| `cancel_leave` | Validates (own request, pending/approved, not started), asks to confirm, then cancels |
| *Manager only* | |
| `get_pending_approvals` | Direct reports' requests waiting for a decision |
| `get_team_leave` | Direct reports' approved and pending leave in a date range |
| `decide_leave_request` | Approve or reject a direct report's pending request, after confirmation |

No tool takes an employee ID. Every tool reads the identity from graph state, which only the server sets.
The three manager tools are bound to the model **only when the logged-in user is a manager** (employees don't pay
tokens for them), every manager query is scoped to direct reports in SQL, and each manager tool re-checks the role,
so an employee session can't use them even if the model tried.

### Applying for leave (human in the loop)

```mermaid
sequenceDiagram
  actor U as User
  participant UI as React UI
  participant API as Express API
  participant G as LangGraph agent
  participant DB as SQLite

  U->>UI: "Apply for earned leave Dec 22 to Jan 2"
  UI->>API: POST /api/chat {message, threadId}
  API->>G: run (employeeId from JWT)
  G->>G: Claude calls apply_leave
  G->>G: validate in code (balance, tenure, overlap, notice, CL limit)
  G-->>API: interrupt(summary) — graph paused, state checkpointed
  API-->>UI: {confirmation: 7 working days, balance 21 → 14}
  UI->>U: confirmation card (input disabled)
  U->>UI: Submit
  UI->>API: POST /api/chat/confirm {threadId, approved: true}
  API->>G: Command({resume: {approved: true}})
  G->>DB: INSERT leave request (status: pending)
  G-->>API: "Submitted, request #9, pending manager approval"
  API-->>UI: reply
```

If the user cancels, nothing is written. If the request breaks a rule, the agent explains the problem and
never shows a confirmation. Cancelling a request and a manager's approve/reject use the same pattern: validate in
code, interrupt, write only after confirmation.

---

## Design decisions

**Math and rules live in code, not in the LLM.** Working days, balances, loss of pay, pro-rata and encashment are
pure functions with unit tests. The model only chooses tools, fills arguments and explains results; the prompt tells
it not to do arithmetic (not even totals).

**Identity can't be talked around.** `employeeId` flows *verified JWT → request → graph state → tools*. Nothing the
user types or sends in the request body can change it; requests for other employees are refused. Conversation
threads are keyed `employeeId:threadId`, so a guessed thread ID can't load someone else's chat.

**Writes are validated, then confirmed.** `apply_leave` checks every hard rule in code (balance, 6-month tenure for
earned leave, overlapping requests, no past dates, casual leave ≤ 3 consecutive days, 7 days' notice for 3+ days of
earned leave) *before* asking. The LangGraph interrupt pauses the graph; on resume the tool re-runs from the top, so
everything before the interrupt is side-effect free and the database write comes last.

**Grounded policy answers.** Policy files (Markdown, text, PDF, Word) are split into short sections by heading and indexed with BM25 at startup. Results
must match at least one distinctive word, so a question about an uncovered topic returns nothing and the agent says
the policy doesn't cover it. Answers cite the source section.

**Keyword search instead of embeddings.** Anthropic has no embeddings API, and the policy set is small and well
structured. Local BM25 needs no second provider, no API calls and no tokens, and it is deterministic and testable.
A small synonym map (vacation → earned leave, WFH → work from home, ...) covers common paraphrases.

**Token efficiency as a design goal.** Every request costs tokens, so each choice was made for low token use:

| Lever | Choice |
|---|---|
| Model | Claude Haiku 4.5 (cheapest Claude), swappable via `LLM_PROVIDER` / `LLM_MODEL` |
| Prompt + tool schemas | Terse; ~1.5k tokens per call for an employee (9 tools); managers ~1.85k (12 tools) |
| Role-based tools | Manager tools and prompt rules sent only for managers |
| Tool results | Compact JSON, no echoed inputs, empty fields omitted |
| History | Tool traffic removed after each turn; last 4 Q&A pairs kept |
| Answers | "Under 80 words, table only for 3+ rows" — output tokens cost 5× input |
| Redundant calls | Prompt and tool descriptions steer to the minimal tool set |
| Retrieval | Local BM25: zero tokens to search, ≤ 3 short sections returned |

Measured examples: a refusal costs 1 model call (~1.7k input tokens); "what's my balance" 2 calls (~3.6k in /
~115 out); a full leave application ~4.2k in / ~230 out — roughly half a US cent per question.

**Provider-agnostic.** The app only sees LangChain's `BaseChatModel`. Switching to Gemini is a `.env` change;
another provider is one `case` in `server/src/llm.ts`. Gemini's free-tier rate limit (5 requests/minute) needed a
custom retry handler that honours the server's `retryDelay`; it is included and tested.

---

## Security and data

- Synthetic data only; passwords are bcrypt hashes; the seed prints the demo password.
- JWT (HS256, 8h, `algorithms` pinned so `alg: none` is rejected). Wrong password and unknown email return the same
  message and take the same time.
- Login rate limiting: after 5 failed attempts for the same email and IP within 15 minutes, logins return 429 with
  `Retry-After` (in memory; a shared store would be needed across several servers).
- Managers see only their direct reports; nobody can decide their own request.
- API returns only public employee fields; malformed or oversized requests are rejected (1000-char messages, 10 kB
  bodies); server errors are generic to the client.
- The UI keeps the token in memory only (no localStorage).
- Secrets live in `server/.env` (gitignored); `.env.example` has placeholders.

---

## Testing

```bash
npm test     # 51 tests, no LLM calls, no API cost
npm run eval # 13 cases against the real model (~$0.07 per run)
```

| Area | What is covered |
|---|---|
| Leave math | Working days across Christmas/New Year, tenure, pro-rata, encashment, loss of pay, invalid dates |
| Leave validation | Every apply_leave and cancel_leave rule, on a fresh temporary database |
| Policy search | Section parsing (Markdown, text, PDF and Word fixtures), heading detection, long-section splitting, unreadable files reported, stemming, correct top section for 6 questions, "not covered" cases |
| Agent graph | The real graph with a **scripted fake model** and a temp database: pause → confirm → write, cancel, rule violations, per-employee threads, history cap, manager approve/reject, manager can't decide own request, employee can't use manager tools |
| API + auth | Login, forged/expired/`alg:none`/unknown-user tokens, body `employeeId` ignored, thread IDs, confirm endpoint (409 when nothing is pending), login rate limiting |
| Retry handler | Gemini per-minute vs daily quota errors |

**Evaluation set** (`npm run eval`): unit tests check our code with a fake model; the eval checks the real agent.
13 scripted cases (policy citation, "not covered", balance, multi-tool dates, follow-up, apply/cancel/approve with
confirmation, rule enforcement, privacy, new joiner, manager flows) assert which tools were called, that no
redundant tools were called, which confirmation appeared, and what the answer must or must not contain. It runs on a
fresh temporary database with a pinned date and prints pass/fail, tokens and estimated cost. Current result: 13/13.
The eval already found and fixed one inefficiency (redundant balance and holiday lookups on date questions).

LangSmith traces (`LANGSMITH_TRACING=true`) show each turn's agent → tools → agent → trim steps, the exact
prompts, tool inputs/outputs and token counts.

---

## Project structure

```
├── package.json            # root scripts: setup, dev (API + UI), test, eval, typecheck, db:reset
├── scripts/free-ports.cjs  # runs before dev: stops this project's leftover dev servers
├── server/
│   ├── policies/           # sample policy documents (Leave, Holiday, Attendance/WFH); any .md/.txt/.pdf/.docx
│   └── src/
│       ├── agent/          # graph.ts (StateGraph), state.ts, prompt.ts, run.ts (turn runner)
│       ├── tools/          # index.ts (employee tools), manager.ts (team tools), common.ts
│       ├── hr/             # leaveMath (pure), leaveRequest (validation), repo (SQL), dates
│       ├── rag/            # policyIndex.ts (BM25), documents.ts (md/txt/pdf/docx loading)
│       ├── eval/           # cases.ts + run.ts: evaluation against the real model
│       ├── auth/           # login, JWT sign/verify, login rate limiter
│       ├── server/         # Express app + entry point
│       ├── db/             # schema, seed, temp-DB helper for tests
│       ├── llm.ts          # model factory (provider switch, Gemini retry handler)
│       ├── config.ts       # all settings
│       └── cli.ts          # terminal chat for development
├── client/src/             # React + MUI: LoginPage, ChatPage, ConfirmLeaveCard, api.ts
└── docs/PROGRESS.md        # stage-by-stage build log and decision record
```

---

## Limitations and future enhancements

- **Persistent memory:** conversations use an in-memory checkpointer and reset when the server restarts. A
  SQLite/Postgres checkpointer would persist them (the SQLite package currently pins an older better-sqlite3).
- **Semantic retrieval:** embeddings or hybrid search once the policy set grows beyond keyword search's reach.
- **Streaming replies** token by token to the UI (needs to coexist with confirmation pauses).
- **Sessions:** httpOnly cookie + refresh tokens instead of an in-memory bearer token; shared store for rate limits.
- **Leave edge cases:** half-day leave, year-boundary balances (a Dec–Jan request is currently checked against the
  current year's balance), manager comments on decisions, notifications.
- **Manager scope:** skip-level managers and HR admin views.
- **Prompt caching** once the cached prefix reaches Haiku 4.5's 4,096-token minimum (or on a model with a lower
  minimum).
- **Eval in CI** with a small per-run budget, plus more cases (paraphrases, multi-turn edge cases).
