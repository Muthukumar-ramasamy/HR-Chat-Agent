# Build Log — HR Chat Agent

Running log of every stage: what was built, why, how to run it, and what's next.
Read this together with [CLAUDE.md](../CLAUDE.md) (goals, stack, rules, plan) to pick up
work without missing context. Update it at the end of every stage.

---

## Current status

| Stage | Description | Status |
|---|---|---|
| 1 | Project setup, SQLite schema + synthetic seed, bare Gemini CLI chat | ✅ Done — user-tested (chat, memory, LangSmith traces) |
| 2 | HR tools + tool calling (+ switch to Claude Haiku 4.5, token diet) | ✅ Done — user-tested |
| 3 | LangGraph agent wiring all tools | ✅ Done — user-tested, all cases |
| 4 | `search_policy` RAG over policy docs (local BM25 keyword search) | ✅ Done — user-tested, all 5 cases (incl. policy + data milestone) |
| 5 | Express API + JWT login, employee_id from token into state | ✅ Done — user-tested via PowerShell |
| 6 | Conversation memory (checkpointer) + `apply_leave` interrupt | ✅ Done — user-tested (approve, duplicate blocked, cancel) |
| 7 | React + MUI chat UI (+ root `npm run dev` for API + UI) | ✅ Done — user-tested in browser |
| 8 | LangSmith tracing, README + Mermaid diagram, demo, push, submit | README + demo script done; pushed to GitHub; demo recording + submission pending |

**Next action:** submit (video `HR-Assist-demo.webm` on Desktop, repo link, README + docs/HR-Assist-Architecture.pdf). Optional: streaming replies (skipped: risk vs. deadline).

**Repository:** https://github.com/Muthukumar-ramasamy/HR-Chat-Agent (public, branch `main`).

**Commits:** `6d4384a` Stage 1 · `816929d` Stage 2 · `a0af586` Stage 3 · `85dbcf8` Stage 4 · `5f9d4c6` Stage 5 · `83bffa1` Stage 6 · `73d04de` Stage 7.

---

## Environment

- Windows 11, PowerShell. Node **v25.9.0** (Current, not LTS), npm 11.12.1.
- `better-sqlite3` verified working on Node 25 (prebuilt binary, no compiler needed).
- Git repo at project root.
- **Cost:** Haiku 4.5 = $1/M input, $5/M output; a typical turn (~3.5k in / ~200 out) ≈ $0.005. Prefer no-LLM
  checks (unit tests, direct tool calls, scripted fake model) over live calls. `LLM_PROVIDER=google` is a
  free-tier fallback.
- **LLM: Claude Haiku 4.5 (`claude-haiku-4-5`) via `@langchain/anthropic`** — switched from Gemini on
  2026-10-03 at user request ("use the model that uses the fewest tokens"). Needs `ANTHROPIC_API_KEY` in
  `server/.env`. Gemini remains available with `LLM_PROVIDER=google` (free tier: only 5 requests/minute).

## Repository layout

```
HR bot/
├── package.json           # root scripts: setup, dev (API + UI together via concurrently), test, typecheck
├── CLAUDE.md              # project brief (goals, stack, rules, plan)
├── .gitignore             # ignores node_modules, .env*, *.db (keeps .env.example)
├── docs/
│   └── PROGRESS.md        # this file
├── client/                # React + MUI chat UI (Vite)
│   ├── vite.config.ts     # dev server :5173, proxies /api -> :3001
│   └── src/
│       ├── main.tsx       # MUI theme (light/dark from OS), CssBaseline
│       ├── App.tsx        # session {token, employee} in memory -> LoginPage | ChatPage
│       ├── api.ts         # login / sendMessage / confirmLeave, ApiError, response types
│       ├── LoginPage.tsx  # email/password + demo-account chips
│       ├── ChatPage.tsx   # chat, suggestions, tool/token caption, confirmation flow
│       └── ConfirmLeaveCard.tsx  # Submit / Cancel card for apply_leave
└── server/                # Node/TypeScript backend + agent
    ├── package.json       # "type": "module"; scripts below
    ├── tsconfig.json      # strict, noEmit, moduleResolution "bundler" (extensionless imports)
    ├── .env.example       # placeholders only; real keys go in server/.env
    ├── data/hr.db         # generated SQLite file (gitignored)
    ├── policies/          # synthetic HR policy docs (markdown, '## N. Title' sections)
    │   ├── leave-policy.md        # 10 sections
    │   ├── holiday-policy.md      # 4 sections
    │   └── attendance-policy.md   # 4 sections
    └── src/
        ├── config.ts      # all runtime settings in one place
        ├── llm.ts         # createChatModel() — the ONLY place the provider is chosen (anthropic | google); Gemini retry handler
        ├── llm.test.ts    # retry handler tests (simulated Gemini errors)
        ├── cli.ts         # dev CLI chat (--as skips login), uses agent/run.ts
        ├── auth/
        │   └── auth.ts    # login (bcrypt), signToken / verifyToken (HS256 JWT)
        ├── server/
        │   ├── app.ts       # createApp(runTurn): /api/health, /api/login, /api/me, /api/chat
        │   ├── app.test.ts  # API tests with a fake agent (no LLM)
        │   └── index.ts     # starts the server (npm run dev)
        ├── agent/
        │   ├── prompt.ts  # buildSystemPrompt() — today's date + rules
        │   ├── state.ts   # AgentState: messages + employeeId (Annotation)
        │   ├── run.ts     # createTurnRunner(graph): run({employeeId, threadId, message | resume}) -> {reply, confirmation?, toolCalls, usage}
        │   ├── graph.test.ts  # real graph + scripted fake model + temp DB (interrupt, memory, trim)
        │   └── graph.ts   # buildAgentGraph(): agent -> tools -> agent ... -> trim -> END
        ├── tools/
        │   └── index.ts   # the 7 HR tools (hrTools array), incl. search_policy
        ├── rag/
        │   ├── policyIndex.ts       # parsePolicy, tokenize/stem, BM25 PolicyIndex, getPolicyIndex()
        │   └── policyIndex.test.ts
        ├── hr/
        │   ├── dates.ts         # ISO date helpers (UTC), today() (APP_TODAY override)
        │   ├── leaveMath.ts     # pure deterministic calculations
        │   ├── leaveMath.test.ts
        │   ├── leaveRequest.ts      # validateLeaveRequest(): hard rules before confirmation
        │   ├── leaveRequest.test.ts
        │   └── repo.ts          # read-only SQL queries
        └── db/
            ├── schema.ts  # CREATE TABLE statements
            ├── index.ts   # getDb() singleton (WAL, foreign keys, applies schema)
            └── seed.ts    # synthetic demo data
```

## Scripts

From the **project root**:

| Command | What it does |
|---|---|
| `npm run setup` | Install root + server + client dependencies and seed the database (first time) |
| `npm run dev` | **Start API (:3001) and UI (:5173) together** — `[api]` blue / `[web]` green output; API without file watching, so chat memory survives |
| `npm run dev:watch` | Same, but the API restarts on file changes (clears chat memory) |
| `npm test` | Server test suite |
| `npm run typecheck` | Typecheck server and client |
| `npm run db:reset` | Reseed the synthetic demo data |

Inside `server/`:

| Command | What it does |
|---|---|
| `npm run db:seed` | Creates `data/hr.db` and seeds it — only if empty (safe to re-run) |
| `npm run db:reset` | Clears the demo tables and reseeds |
| `npm run dev` | Start the API on :3001 with auto-restart on file changes (`npm start` = no watch) |
| `npm run chat` | CLI chat as E1001 (Asha). `npm run chat -- --as E1003` to be another seeded employee |
| `npm run graph` | Print the agent graph as a Mermaid diagram (for README) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | All tests (36): leave math, retry handler, retrieval, API/auth, leave validation, graph (scripted model). No LLM calls |

Code runs with `tsx` (TypeScript executed directly, no build step).

## Installed packages

| Package | Version | Purpose |
|---|---|---|
| @langchain/core | 1.2.x | Messages, chat model interface, tools |
| @langchain/anthropic | 1.5.x | Claude chat model (default provider) |
| @langchain/google-genai | 2.3.x | Gemini chat model + embeddings |
| @langchain/langgraph | 1.4.x | Agent graph, checkpointer, interrupts (used from Stage 3) |
| better-sqlite3 | 13.x | SQLite (synchronous API) |
| bcryptjs | 3.x | Password hashing (pure JS — no native build; same bcrypt format) |
| dotenv | 18.x | Loads `server/.env` (`quiet: true` to suppress its log line) |
| zod | 4.x | Tool input schemas, API body validation |
| express | 5.x | HTTP API (async errors handled natively) |
| jsonwebtoken | 9.x | JWT sign/verify (HS256) |
| cors | 2.x | Allow the React dev origin only |
| typescript (dev) | 7.x | Typecheck only |
| tsx (dev) | 4.x | Run TS directly |

---

## Stage 1 — Project setup, database, bare chat loop

### What was built

**Config ([server/src/config.ts](../server/src/config.ts))**
- `config.dbPath` (default `./data/hr.db`), `config.llm.{provider, model, temperature: 0, maxRetries: 6, apiKey()}`.
- `apiKey()` is a function so it's only required when the LLM is actually used —
  `db:seed` works without a key. It throws a clear error if the key is missing or still
  the `your-...` placeholder.

**Model factory ([server/src/llm.ts](../server/src/llm.ts))**
- `createChatModel(): BaseChatModel` — switch on `LLM_PROVIDER`; only `"google"` today.
- Rest of the app depends only on `BaseChatModel`, so moving to Claude/OpenAI = add one
  `case` + install the provider package + change `.env`. (Satisfies "provider swappable in one place".)
- Rate limits: `maxRetries: 6` uses LangChain's built-in retry with exponential backoff.
  **Superseded in Stage 2** — see the Gemini retry handler below (LangChain's default gave up on Gemini 429s).

**Database schema ([server/src/db/schema.ts](../server/src/db/schema.ts))**

| Table | Key columns | Notes |
|---|---|---|
| `employees` | id (`E1000`…), name, email, password_hash, role (`employee`/`manager`), grade, department, location, joining_date, manager_id | Location drives the holiday calendar |
| `leave_types` | code (`CL`/`SL`/`EL`), annual_quota, min_tenure_months, max_carry_forward, encashable | Machine-readable rules for deterministic code (eligibility/calculations). Policy docs (Stage 4) must describe the same rules in prose |
| `leave_allocations` | (employee_id, leave_type, year) PK, allocated, carried_forward | Days granted. **Used/pending are NOT stored** |
| `leave_requests` | id, employee_id, leave_type, start/end date, days, reason, status (`pending`/`approved`/`rejected`/`cancelled`), applied_on | `days` = working days, computed in code |
| `holidays` | date, name, location (`ALL` or a city) | UNIQUE(date, location) |

Design decision: **available balance = allocated + carried_forward − approved days − pending days**,
derived from `leave_requests` at query time so numbers can never drift.

**Seed data ([server/src/db/seed.ts](../server/src/db/seed.ts)) — all fictional**

Leave rules:

| Code | Name | Quota/yr | Min tenure | Max carry-forward | Encashable |
|---|---|---|---|---|---|
| CL | Casual Leave | 12 | 0 | 0 | No |
| SL | Sick Leave | 12 | 0 | 6 | No |
| EL | Earned Leave | 18 | 6 months | 30 | Yes |

Users (password for all: `Password@123`):

| ID | Name | Email | Role | Grade | Location | Joined | Purpose in demo |
|---|---|---|---|---|---|---|---|
| E1000 | Ravi Kumar | ravi.kumar@example.com | manager | G7 | Chennai | 2017-03-01 | Manager of all others (stretch goal) |
| E1001 | Asha Rao | asha.rao@example.com | employee | G5 | Chennai | 2021-06-14 | **Main demo user**; has history + a pending request |
| E1002 | Dev Patel | dev.patel@example.com | employee | G4 | Bengaluru | 2023-01-09 | Different location → different holidays |
| E1003 | Priya Nair | priya.nair@example.com | employee | G3 | Bengaluru | 2026-07-01 | New joiner: pro-rated quota (6 CL/6 SL), **not EL-eligible** until 6 months |

Asha's (E1001) 2026 balances after seeding:

| Type | Allocated + CF | Approved used | Pending | Available |
|---|---|---|---|---|
| CL | 12 | 1 | 1 (Oct 16) | 10 |
| SL | 12 + 4 = 16 | 2 | 0 | 14 |
| EL | 18 + 8 = 26 | 5 | 0 | 21 |

Holidays: 2026 and 2027, national (`ALL`) + Chennai (Pongal) + Bengaluru (Karnataka Rajyotsava).
Dec 25 2026 and Jan 1 2027 are both Fridays — useful for demo question "Dec 22 – Jan 2".

Seeding behaviour: skips if employees exist; `--reset` deletes child tables first (FK order)
then reseeds, inside one transaction.

**CLI ([server/src/cli.ts](../server/src/cli.ts))**
- readline loop: `you>` / `bot>`; `exit` or `quit` to leave.
- Uses `for await (const line of rl)` rather than `rl.question()`: `question()` dropped lines
  typed while the bot was still replying (found in user testing); the async iterator buffers them.
- Keeps `messages: BaseMessage[]` starting with a `SystemMessage`; appends each
  `HumanMessage` and `AIMessage`. On error, removes the unanswered question.
- System prompt says it has no HR data yet (tools come in Stage 2).

**LangSmith tracing (pulled forward from Stage 8)**
- Enabled purely via env vars in `server/.env`: `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`,
  `LANGSMITH_PROJECT=hr-agent`. LangChain auto-traces every model call (and later tool calls /
  graph steps) — no code wiring needed. `langsmith` client ships with `@langchain/core`.
- `config.tracing` exists only to show "LangSmith tracing: ON/off" in the CLI banner.
- CLI calls `awaitAllCallbacks()` on exit so background trace uploads finish before the process ends.
- View traces at https://smith.langchain.com → Projects → `hr-agent`. Each trace shows the full
  messages sent (incl. system prompt), the reply, tokens and latency.

### Concepts introduced

- **The LLM is stateless.** Each call sends the full conversation; "memory" is just the
  messages array we resend. Stage 6 replaces this with a LangGraph checkpointer keyed by `thread_id`.
- **Message roles.** `SystemMessage` = instructions/rules (later: cite sources, refuse other
  employees' data, say "not covered" instead of guessing). `HumanMessage` = user. `AIMessage` = model.
- **Temperature 0** for consistent, factual answers.

### Verified

- `npm run typecheck` passes.
- `npm run db:seed` seeds correctly; second run skips. Counts: 4 employees, 3 leave types,
  12 allocations, 8 requests, 18 holidays.
- Every seeded request's `days` matches its weekday count.
- `npm run chat` without a key → `Missing env var GOOGLE_API_KEY…`, exit code 1.
- User verified a real Gemini call with `gemini-3.8-flash` (2026-10-03): greeting works and the
  system prompt is followed (bot says it has no HR data yet).

### How to test

```powershell
cd server
copy .env.example .env     # paste key from https://aistudio.google.com/apikey
npm run chat
```
Try: "Hi, what can you help with?" → "My name is Asha" → "What's my name?" (history works)
→ "What's my leave balance?" (should say it can't look that up yet).
Model: `gemini-3.8-flash`. (`gemini-2.5-flash` returned 404 "no longer available to new
users" on 2026-10-03.) If a model is retired, change `LLM_MODEL` in `.env` — no code change.

---

## Stage 2 — HR tools + tool calling

### What was built

**Layering** (each layer only talks to the one below):
`cli.ts` (loop) → `tools/index.ts` (LLM-facing) → `hr/repo.ts` (SQL) + `hr/leaveMath.ts` (pure math) → SQLite.

**Deterministic math ([server/src/hr/leaveMath.ts](../server/src/hr/leaveMath.ts))** — no DB, no LLM:

| Function | Rule |
|---|---|
| `countWorkingDays(start, end, holidays)` | Inclusive range; skips Sat/Sun and weekday holidays; returns calendar/weekend/holiday/working counts + holiday list |
| `tenureMonths(joining, asOf)` | Whole months completed |
| `eligibleFrom(joining, minMonths)` | Joining date + N months, clamped to month end |
| `proRataEntitlement(quota, joining, year)` | Joiners: quota × remaining months / 12; joining month counts if joined on/before the 15th; round to 0.5. Earlier joiners: full quota |
| `encashableDays(available, encashable)` | min(available, **15**) if encashable, else 0 (`ENCASHMENT_MAX_DAYS_PER_YEAR`) |
| `lossOfPayDays(requested, available)` | requested − max(available, 0), floored at 0 |

**Dates ([server/src/hr/dates.ts](../server/src/hr/dates.ts))**: all ISO `YYYY-MM-DD` in UTC; strict
validation (rejects `2026-02-30`). `today()` returns `APP_TODAY` from `.env` if set (for reproducible
demos), else the real local date.

**Queries ([server/src/hr/repo.ts](../server/src/hr/repo.ts))**: `getEmployee`, `getLeaveType`,
`getLeaveBalances(id, year, type?)` (computes used/pending/available in SQL; requests count toward
the year they *start* in), `getLeaveRequests(id, from, to)` (overlap), `getHolidays(location, from, to)`
(location + `ALL`), `listLocations`.

**Tools ([server/src/tools/index.ts](../server/src/tools/index.ts))** — exported as `hrTools`:

| Tool | Input (zod) | Returns |
|---|---|---|
| `get_employee_profile` | none | profile, tenure, manager name |
| `get_leave_balance` | `leave_type?` | current-year balances + `total_available` |
| `get_leave_history` | `from_date?`, `to_date?` (default current year) | requests overlapping range |
| `get_holidays` | `year`, `location?` (default own) | holidays; unknown location → error listing known ones |
| `calculate_leave` | `calculation` = `leave_days` \| `pro_rata_entitlement` \| `encashment`, `leave_type?`, `start_date?`, `end_date?` | `leave_days`: working days, holidays hit, overlapping approved/pending requests; with `leave_type` also available, covered, **loss_of_pay_days** (+ note if range spans two years — checked against current-year balance) |
| `check_eligibility` | `leave_type` | eligible, reasons (tenure with eligible-from date; zero balance), tenure, balance |

Not yet built (later stages): `search_policy` (Stage 4), `apply_leave` (Stage 6).

**Identity rule**: no tool has an employee-ID parameter. Each tool reads
`config.configurable.employee_id` from the run config (`currentEmployee(config)`); missing → throws
"No authenticated employee in this session." The CLI sets it from `--as` (default `E1001`) as a
stand-in for login; Stage 5 sets it from the verified JWT.

**System prompt ([server/src/agent/prompt.ts](../server/src/agent/prompt.ts))**: includes today's
weekday + date; tools act on the logged-in employee; refuse other employees' data *directly without
tool calls*; use tools for every fact; never do date/leave arithmetic (not even totals); resolve
relative dates ("next week" = next Mon–Fri) and state them; CL/SL/EL meanings; policy docs not
connected yet.

**Tool-calling loop ([server/src/cli.ts](../server/src/cli.ts) `runTurn`)** — hand-written on purpose:
1. `model.bindTools(hrTools)` → model sees tool names/descriptions/JSON schemas.
2. Invoke model with full history. If the `AIMessage` has no `tool_calls` → final answer.
3. Else run each tool (`tool.invoke({...call, type: "tool_call"}, runConfig)` → `ToolMessage`
   linked by `tool_call_id`), append, loop. Tool errors become `ToolMessage(status: "error")` so the
   model can self-correct. Max 8 rounds.
4. The original `AIMessage` object is pushed back unchanged — **Gemini 3 needs its "thought
   signature" metadata on tool-call messages** returned in later requests.
5. On failure the whole turn is removed from history (`messages.splice(turnStart)`).
6. Tool calls/results are printed dimmed (`-> name(args)`, `<- result`).
- Readline fix: input closing mid-turn (piped input) no longer throws "readline was closed".

**Gemini retry handler ([server/src/llm.ts](../server/src/llm.ts) `geminiRetryHandler`)**
- Problem found in live testing: Gemini's per-minute 429 message says "exceeded your current quota…
  billing", which LangChain's default handler classifies as a *hard* quota error → no retry at all.
- Fix: pass `onFailedAttempt` to the model. LangChain's retry loop (p-retry) awaits it: return → retry,
  throw → stop. On 429 it reads Gemini's `errorDetails` (`RetryInfo.retryDelay`, quota IDs):
  per-day quota → stop with a clear message; delay ≤ 65s → print notice, sleep delay + 1s, retry;
  longer → stop. 400/401/403/404 → stop. Other errors (5xx/network) → retry with exponential backoff.

### Concepts introduced

- **Tool calling.** The model never runs code. It returns a structured request
  (`tool_calls: [{name, args, id}]`); *our* code executes it and sends back a `ToolMessage`. The
  model then continues with the result. Tool descriptions are effectively prompt text — they decide
  when the model picks a tool.
- **The agent loop.** Model → tools → model → … until a plain-text answer. That loop *is* an agent;
  Stage 3 moves it into a LangGraph graph (nodes: model, tools; conditional edge on `tool_calls`).
- **Parallel tool calls.** One model response can request several tools (seen live: `calculate_leave`
  + `check_eligibility` ×2 in one round).
- **Context outside the LLM.** `employee_id` travels in the run config, not the prompt, so a user
  can't talk the model into another identity.
- **Deterministic vs. generative.** Math and rules live in tested code; the LLM only picks tools,
  fills arguments and explains results.

### Verified

- `npm run typecheck` passes; `npm test` 10/10 (6 leave-math, 4 retry-handler with simulated errors).
- Every tool invoked directly (no LLM) against seed data — results match expectations, e.g.
  Asha Dec 22–Jan 2 = 12 calendar / 3 weekend / 2 holidays / **7 working days**; Oct 12–16 flags the
  pending Oct 16 request; Priya EL not eligible ("eligible from 2027-01-01"), pro-rata CL = 6;
  Asha EL encashable 15 of 21; no identity → throws; bad date → throws.
- Live Gemini run (as Asha, today 2026-10-03):
  - "What's my leave balance?" → single `get_leave_balance` call, correct table.
  - "Can I take 5 days off next week?" → resolved to Mon Oct 5–Fri Oct 9, called
    `calculate_leave` + `check_eligibility`(CL, EL) → correct "yes, 5 working days" answer.
  - "What is Dev Patel's leave balance?" → refused (before the prompt fix it made an unneeded
    `get_employee_profile` call; prompt now says refuse without tools — not re-verified live).
  - First run hit the 5 RPM limit and failed → led to the retry handler (live retry not yet observed).

### How to test

```powershell
cd server
npm test                       # no API calls
npm run chat                   # as Asha (E1001, Chennai)
```
Try:
1. "What's my leave balance?" → one tool call
2. "Can I take 5 days off next week?" → several tools, states the exact dates
3. "Can I take Dec 22 to Jan 2 off?" → 7 working days (Christmas + New Year excluded)
4. "What if I take sick leave instead?" → follow-up uses the same dates
5. "What is Dev Patel's leave balance?" → refusal, no tool call
6. "Am I eligible for earned leave?" as Priya: `npm run chat -- --as E1003` → not eligible until 2027-01-01

Expect occasional `[rate limited by Gemini, retrying in Ns]` — that's the 5 RPM free tier.

---

## Provider switch — Gemini → Claude Haiku 4.5 (during Stage 2)

- `config.ts`: `LlmProvider = "anthropic" | "google"`; default provider `anthropic`; per-provider default
  model (`claude-haiku-4-5` / `gemini-3.8-flash`) and API-key env var (`ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`);
  empty `LLM_MODEL` → provider default; unknown provider → error at startup. New `maxTokens: 2048` reply cap.
- `llm.ts`: `ChatAnthropic({ model, temperature: 0, maxTokens, maxRetries: 6, apiKey })`. Claude 429s include a
  `retry-after` header and no "quota/billing" wording, so LangChain's default retry handles them; the custom
  `geminiRetryHandler` stays on the Gemini branch only. Out-of-credit errors are 400 → not retried.
- `cli.ts`: prints `[N model calls, tokens: X in / Y out]` after each answer (sums `usage_metadata` of the turn's
  AI messages). Input tokens grow per call because each call resends the full history + tool schemas.
- `.env.example` rewritten for both providers.
- No other code changed — tools, prompt and loop are provider-agnostic (proves the "swappable in one place" rule).
- **Prompt caching not used:** Haiku 4.5 only caches prefixes ≥ 4096 tokens; our system prompt + tool schemas are
  smaller, so caching would silently do nothing.
- First Claude run ("Dec 22 – Jan 2"): correct (7 working days, EL, no LOP), 2 model calls, 4965 in / 488 out tokens.
  Issues fixed: model made unneeded `get_employee_profile` + 2× `get_holidays` calls (prompt now says call only needed
  tools; `calculate_leave` description says holidays/location are already handled) and computed "14 remaining" itself
  (`calculate_leave` now returns `balance_after_leave`).

## Token diet (standing rule from 2026-10-03: "always use fewer tokens")

Rule added to CLAUDE.md "Key design rules" and saved to assistant memory. Every stage must pick the
lower-token option and report the impact. Changes made:

| Lever | Change | Estimated effect (chars/4) |
|---|---|---|
| System prompt ([prompt.ts](../server/src/agent/prompt.ts)) | Rewritten tersely; adds "under 80 words, table only for 3+ rows, no filler" | ~348 → ~187 tok per call |
| Tool schemas ([tools/index.ts](../server/src/tools/index.ts)) | One-line descriptions; removed per-field `.describe()`; leave-code meanings only in system prompt | ~918 → ~637 tok per call |
| Tool results | No echoed inputs; dropped redundant fields (email, employee_id, names, year per row, covered_by_balance, tenure_months…); lists as compact strings (`"2026-12-25 Christmas"`, `"#4 CL 2026-10-16..2026-10-16 pending"`); overlapping_requests omitted when empty | all six tools ~586 → ~365 tok |
| History ([cli.ts](../server/src/cli.ts)) | After a successful turn, keep only the question + final answer; drop that turn's tool calls/results (`messages.splice(turnStart + 1, …)`). The answer already states dates/numbers, so follow-ups still work | Later turns no longer resend old tool payloads |
| Output | `maxTokens` 2048 → 1024 (cap only); prompt asks for short answers. Output tokens cost 5× input on Haiku | Expected: ~424 → ~150 out per answer |
| Redundant calls | Prompt: "call only the tools needed"; calculate_leave already covers holidays/balance/LOP | 5 → 2 tool calls on "Dec 22 – Jan 2" |

Measured live (before diet, after the redundant-call fix): "Dec 22 – Jan 2" = 2 model calls, 4643 in / 424 out.
Measured live after diet: Priya "Am I eligible for earned leave?" → 1 tool call (check_eligibility), correct
(not eligible until 2027-01-01), 2 model calls, **3203 in / 111 out** (~1.6k input per call = fixed baseline of
prompt + tool schemas + Anthropic tool-use overhead; output down ~75% vs earlier answers).
Not used: prompt caching (Haiku 4.5 minimum cacheable prefix is 4096 tokens; ours is ~1.2k incl. Anthropic's
tool-use overhead).
Future levers: Stage 4 RAG — small top-k (2–3) and short chunks; Stage 6 — the checkpointer stores full
history, so add the same trimming as a graph step; consider fewer tools (merge profile into eligibility) if needed.

## Stage 3 — LangGraph agent

### What was built

**State ([server/src/agent/state.ts](../server/src/agent/state.ts))**: `AgentState = Annotation.Root({ ...MessagesAnnotation.spec, employeeId })`.
`messages` uses LangGraph's reducer (appends; `RemoveMessage` deletes by id). `employeeId` is set only by
our code at invoke time — no node lets the model write it. (Tried a Zod state with `MessagesZodState` first:
`messages` typed as `unknown` under Zod v4 → switched to Annotation.)

**Graph ([server/src/agent/graph.ts](../server/src/agent/graph.ts))**:

```mermaid
graph TD;
  __start__ --> agent;
  agent -.->|tool_calls| tools;
  tools --> agent;
  agent -.->|final answer| trim;
  trim --> __end__;
```

- `agent` node: `modelWithTools.invoke([SystemMessage(buildSystemPrompt()), ...state.messages])`. The system prompt
  is prepended per call, **not stored in state** → not saved in history (Stage 6 checkpointer) and always has today's date.
- `tools` node: prebuilt `ToolNode(hrTools)`. Runs all tool calls of the last AIMessage; passes
  `runtime.state` to tools; turns thrown errors into `ToolMessage(status: "error")` ("…Please fix your mistakes.").
- `routeAfterAgent`: last message has `tool_calls` → `tools`, else → `trim`.
- `trim` node: emits `RemoveMessage` for every ToolMessage and tool-calling AIMessage in state → history keeps
  only questions + final answers (same token rule as Stage 2, now inside the graph so the checkpointer will store
  trimmed history too).
- `recursionLimit: 20` per invoke (each agent/tools hop is a step) replaces Stage 2's `MAX_TOOL_ROUNDS`.

**Tools** now read identity from graph state: `tool(async (input, runtime: ToolRuntime<AgentStateType>) => …)`,
`currentEmployee(runtime)` → `runtime.state.employeeId`. Empty/missing → "No authenticated employee in this session."

**CLI ([server/src/cli.ts](../server/src/cli.ts))**: the hand-written loop is gone. Each turn calls
`graph.stream({ messages: [...history, HumanMessage], employeeId }, { streamMode: ["updates", "values"] })`:
"updates" chunks drive live logging (`-> tool(args)`, `<- result`, token sum from agent messages); the last
"values" chunk becomes the new `history`. On error, history is unchanged (turn dropped). `--graph` prints Mermaid.

### Concepts introduced

- **StateGraph**: an agent = state + nodes (functions that return state updates) + edges. Conditional edges are
  how the agent "decides" (here: tools vs. done). Same loop as Stage 2, but declarative, traceable per node in
  LangSmith, and ready for checkpointers (Stage 6) and interrupts (`apply_leave`).
- **Reducers**: `messages` updates are merged (append / remove by id) instead of replaced.
- **Runtime injection**: tools get `runtime.state` from ToolNode → identity flows through state, not the prompt.
- **Streaming modes**: `updates` (per-node deltas) vs `values` (full state snapshots).

### Verified (no LLM)

- `npm run typecheck` passes; `npm test` 10/10.
- `npm run graph` prints the expected Mermaid graph.
- `ToolNode` invoked directly with state `employeeId: "E1003"` → check_eligibility result + bad-date error as
  ToolMessage; with `employeeId: ""` → both tools return "No authenticated employee in this session."
- Live (user): Dev Patel refusal → 1 model call, no tools, 1549 in / 53 out.
- Live (user): "Can I take Dec 22 to Jan 2 off?" → model asked "do you mean 2026–2027?" (wasted turn; terse prompt
  lost the date cue). Fix: prompt rule "No year = next upcoming occurrence (a range may cross into next year); don't
  ask to confirm, state the dates". Re-test: answered directly (Dec 22 2026–Jan 2 2027, 7 working days), 2 model
  calls, 3556 in / 241 out.
- User confirmed after commit: all Stage 3 cases pass, incl. sick-leave follow-up (trim node keeps enough context)
  and Priya EL eligibility.

### How to test

`npm run chat` → same questions as Stage 2 (Dec 22 – Jan 2; sick-leave follow-up; Dev Patel refusal) and
`npm run chat -- --as E1003` → EL eligibility. Expect identical behaviour and similar token counts; LangSmith
traces now show nodes `agent` / `tools` / `trim`.

---

## Stage 4 — Policy RAG (local keyword search)

### What was built

**Policy documents ([server/policies/](../server/policies/))** — synthetic "Acme Corp (fictional)" docs, each
`# Title` + `## N. Section` with 1 short paragraph (short = fewer tokens per retrieved section):
- **Leave Policy** (10): 1 Scope/leave year · 2 CL (12/yr, **max 3 consecutive working days**, not with EL, lapses)
  · 3 SL (12/yr, **medical certificate if > 2 consecutive days**, apply within 2 days after return, carry 6, not
  encashable) · 4 EL (18/yr, **after 6 months' service, ≥3 days need 7 days' notice**, carry 30) · 5 Encashment (EL
  only, max 15/yr, in December) · 6 New joiners pro-rata (same rule as code) · 7 LOP · 8 Weekends/holidays not
  counted · 9 Apply/approve/cancel (pending reserves balance) · 10 Maternity 26 weeks / paternity 5 days.
- **Holiday Policy** (4): calendar per location (Pongal Chennai, Karnataka Rajyotsava Bengaluru) · weekend holidays
  not substituted · comp-off within 30 days · 2 optional holidays/yr.
- **Attendance and WFH Policy** (4): hours 9:30–18:30, core 11–16 · WFH ≤ 2 days/week · half-day CL/SL (EL full days)
  · unplanned absence: tell manager by 10:00, apply within 2 days, else LOP.
- Numbers match `leave_types` + `leaveMath.ts` (quotas, tenure, carry-forward, encashment 15, pro-rata rule).
  Rules that only exist in prose (CL max 3 days, EL notice, SL certificate) are enforced by the LLM via RAG, not code.

**Retriever ([server/src/rag/policyIndex.ts](../server/src/rag/policyIndex.ts))**
- `parsePolicy(md)` → sections `{doc, section, text}`. `getPolicyIndex()` builds once from `policies/*.md`
  (path via `import.meta.url`).
- `tokenize`: lowercase, strip punctuation, stopwords (incl. "policy", "rule", "acme"), crude stem (plural -s/-ies;
  for words > 6 chars strip -ment/-able/-ed/-ing → "encashment/encashed/encashable" = "encash"). Same on docs + queries.
- **BM25** (k1 1.2, b 0.75); heading words counted twice. Query expansion via a small `SYNONYMS` map
  (vacation→earned, wfh→work home, lop→loss pay, doctor→sick medical certificate, …) at **half weight**.
- Filters (token saving + "don't guess"): a section must match ≥ 1 **distinctive** term (df ≤ N/3 — "leave" alone
  doesn't count); keep hits ≥ 50% of best score; max 3.

**Tool `search_policy({query})`** (first in `hrTools`, no identity needed) → `{results: [{source:
"Leave Policy §4 Earned Leave (EL)", text}]}` or `{results: [], note: "No matching policy section."}`. ~70–220 tokens.

**Prompt**: "can I take X to Y off?" → calculate_leave + search_policy for that leave type's rules, in parallel;
policy answers only from search_policy results with citation "(Leave Policy §4)"; if results don't answer →
"the policy documents don't cover it"; never guess policy. Removed "policy docs not connected".

### Concepts introduced

- **RAG**: retrieve relevant text, put only that in the model's context, answer from it with citations. Retrieval
  quality = answer quality; the model can't cite what wasn't retrieved.
- **Lexical (BM25) vs semantic (embeddings) retrieval**: BM25 scores shared words weighted by rarity (IDF) and
  term frequency with length normalisation. No API, deterministic, testable; weaker on paraphrases (mitigated by
  synonyms). Embeddings = future enhancement.
- **Grounding / refusal**: returning *nothing* for weak matches is what lets the agent say "not covered".

### Verified (no LLM)

- `npm run typecheck`; `npm test` **17/17** (7 retrieval tests: parse, tokenize, 18 sections indexed, 6 questions →
  correct top section, mixed "encash vacation" returns both §4 and §5, unrelated "pet insurance" + "bereavement
  leave" → none, cap/threshold).
- Spot checks: "what is LOP" → §7 only; "maternity leave" → §10 only; "leave" → none.
- Size: system prompt ~255 tok, 7 tool schemas ~738 tok (was ~187/~637 with 6 tools).
- User-tested live (2026-10-03): all 5 cases below pass, including the agent-core milestone.

### How to test

`npm run chat` (Asha):
1. "How many earned leave days can I carry forward?" → 30, cites (Leave Policy §4)
2. "Can I take 5 days casual leave next week?" → **combines policy + data**: balance ok (10 CL) but CL max 3
   consecutive days (§2) → suggests EL. *(Plan milestone)*
3. "Do I need a medical certificate for 3 days of sick leave?" → yes, > 2 days (§3)
4. "What is the bereavement leave policy?" → policy documents don't cover it (no guessing)
5. "Can I encash my earned leave?" → yes, max 15/yr in December (§5); optional follow-up "how many can I encash?" →
   calculate_leave encashment = 15

---

## Stage 5 — Express API + JWT login

### What was built

**Config** ([config.ts](../server/src/config.ts)): `server.{port 3001, corsOrigin http://localhost:5173, maxMessageChars 1000}`,
`auth.{jwtSecret() (required, at least 32 chars, lazy so the CLI doesn't need it), tokenTtl "8h"}`. `.env.example`
adds `JWT_SECRET`, `PORT`, `CORS_ORIGIN`.

**Auth ([auth/auth.ts](../server/src/auth/auth.ts))**
- `login(email, password)`: `repo.getLoginRecord` (only query returning `password_hash`; email `COLLATE NOCASE`) +
  `bcrypt.compare`. Unknown email still compares against a dummy hash, so it takes as long as a wrong password.
- `signToken(id)`: HS256, `sub` = employee ID, 8h expiry. `verifyToken`: `algorithms: ["HS256"]` (rejects
  `alg: none`), returns `sub` or undefined.

**Shared turn runner ([agent/run.ts](../server/src/agent/run.ts))**: `createTurnRunner(graph)` returns
`runTurn({employeeId, history, message}, onEvent?)` → `{reply, messages, toolCalls, usage}`. Moved out of the CLI so
CLI and API run the agent identically; the CLI prints events via `onEvent`.

**API ([server/app.ts](../server/src/server/app.ts))**: `createApp(runTurn)` (runner injected, so it is testable without an LLM):

| Route | Auth | Body | Response |
|---|---|---|---|
| `GET /api/health` | none | none | `{ok: true}` |
| `POST /api/login` | none | `{email, password}` | 200 `{token, employee}` · 400 invalid body · 401 "Invalid email or password." (same for unknown email) |
| `GET /api/me` | Bearer | none | `{employee}` |
| `POST /api/chat` | Bearer | `{message}` (1–1000 chars) | `{reply, toolCalls, usage}` |

- `requireAuth`: `Authorization: Bearer <jwt>` → `verifyToken` → `getEmployee` (deleted user = 401) →
  `res.locals.employee`. **The only source of employeeId**; any `employeeId` in a request body is ignored.
- `publicEmployee` returns id, name, role, grade, department, location (no hash, email or manager id).
- JSON limit 10kb; malformed JSON → 400; other errors → generic 500 (details only in the server log).
- Logs one line per chat: `[chat] E1001 tools=calculate_leave,search_policy tokens=3556/241`.
- **Chat is single-turn for now** (`history: []`); Stage 6 adds memory via checkpointer + thread_id.

**Server ([server/index.ts](../server/src/server/index.ts))**: checks `JWT_SECRET` and builds the policy index at
startup; prints "Cannot start server: ..." and exits 1 on config errors.

### Concepts introduced

- **JWT**: a signed (not encrypted) token `header.payload.signature`. The server verifies signature + expiry on
  every request, so the employee ID inside can be trusted. Stateless: no session table.
- **Trust boundary**: identity flows token → `res.locals` → graph state → tools. Nothing the user types or sends in
  the body can change it.
- **Dependency injection for tests**: `createApp(runTurn)` lets tests swap in a fake agent, so zero LLM cost.

### Verified (no LLM)

- `npm run typecheck`; `npm test` **24/24**. 7 new API tests: login OK (case-insensitive email, no hash in the
  response, token `sub` = E1001) · same 401 message for wrong password vs unknown email · 400 for a missing field /
  malformed JSON · chat 401 for no token, garbage, other-secret, expired, `alg:none`, unknown user (agent never
  called) · **body `employeeId: "E1002"` ignored, agent got E1001** · 400 for empty / 1001-char message · `/api/me`.
- Server without `JWT_SECRET` → "Cannot start server: Missing env var JWT_SECRET...", exit 1.
- Smoke test with a temporary secret: `/api/health` OK, login returns token + employee, chat without token → 401.
- User-tested live: login → token; "What is my leave balance?" → get_leave_balance, 2 model calls, 3618 in / 115 out;
  "leave balance for E1002" with body `employeeId: "E1002"` → refused, no tools, 1 model call, 1736 in.

### How to test

1. Add a secret to `server/.env`:
   `node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"` and paste the printed line.
2. `npm run dev` (terminal 1).
3. Terminal 2 (PowerShell):
   ```powershell
   $login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/login -ContentType 'application/json' -Body '{"email":"asha.rao@example.com","password":"Password@123"}'
   $h = @{ Authorization = "Bearer $($login.token)" }
   Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/chat -Headers $h -ContentType 'application/json' -Body '{"message":"What is my leave balance?"}'
   Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/chat -Headers $h -ContentType 'application/json' -Body '{"message":"Show me the leave balance for E1002","employeeId":"E1002"}'
   ```
   Expect Asha's balances, then a refusal (and the server log shows E1001, not E1002).

---

## Stage 6 — Conversation memory + apply_leave with confirmation (interrupt)

### What was built

**Checkpointer**: `buildAgentGraph({ model?, checkpointer? })` compiles with `MemorySaver` by default (model and
checkpointer injectable for tests). State (messages + employeeId) is saved after every step under `thread_id`.
Memory is in-process: lost on server restart (`npm run dev` restarts on file changes; use `npm start` for demos).
The SQLite checkpointer package needs better-sqlite3 12 (we use 13) → not used; persistent memory = future enhancement.

**Threads are per employee**: the runner uses `thread_id = "<employeeId>:<threadId>"`, so a guessed/shared threadId
can never load or resume another employee's conversation.

**History cap** (token rule): the `trim` node removes tool traffic **and** keeps only the last
`MAX_HISTORY_MESSAGES = 8` messages (4 Q&A pairs), starting on a human message.

**Validation ([hr/leaveRequest.ts](../server/src/hr/leaveRequest.ts))** — `validateLeaveRequest(employee, type, start, end)`
→ `{ok, summary}` or `{ok: false, problems[]}`. Hard rules in code (writes must be deterministic):
not in the past (SL may be backdated) · ≥ 1 working day · tenure (EL 6 months) · working days ≤ available ·
CL ≤ 3 consecutive working days (Policy §2) · EL ≥ 3 days needs 7 days' notice (Policy §4) · no overlap with
approved/pending requests. Summary: leave_type, leave_name, dates, working_days, balance_before/after.
(D23 still holds for *answers*; for *writes* the same prose rules are now also enforced in code.)

**Tool `apply_leave({leave_type, start_date, end_date, reason?})`**: validate → if problems, return them (no pause)
→ `interrupt({type: "confirm_leave", ...summary, reason}, {responseSchema: {approved: boolean}})` → if approved,
`repo.createLeaveRequest` (status `pending`, the only DB write in the app) → `{submitted, request_id, status,
balance_after}`; if cancelled → "nothing was saved". On resume LangGraph re-runs the tool from the top, so everything
before `interrupt()` is side-effect free.

**Runner ([agent/run.ts](../server/src/agent/run.ts))**: `createTurnRunner(graph)` → `{ run, hasPendingConfirmation }`.
`run({employeeId, threadId, message})` sends only the new HumanMessage (history comes from the checkpointer);
`run({employeeId, threadId, resume: {approved}})` sends `new Command({resume})`. Interrupts arrive in the "updates"
stream as `__interrupt__` → result has `confirmation` and empty `reply`. `ConfirmationStateError` if resuming with
nothing pending, or sending a message while a confirmation is pending (prevents a dangling tool call in history).

**API**: `POST /api/chat {message, threadId?}` (new UUID if omitted) and `POST /api/chat/confirm {threadId, approved}`
→ `{threadId, reply, confirmation?, toolCalls, usage}`; `ConfirmationStateError` → 409; threadId must be a UUID.

**CLI**: one thread per session (`randomUUID`); on confirmation prints the summary and asks "Submit? (y/n)", then
resumes. Reads input through one async iterator so the y/n answer comes from the same stream.

**Prompt**: "To apply, call apply_leave once dates and type are known (ask only if missing). The app asks the user
to confirm; don't ask yourself. If it returns problems, explain them." Size now ~303 + ~908 tok (8 tools).

**Seed** is now `export function seed({reset, quiet})` (CLI still `npm run db:seed` / `db:reset`) so tests can
seed a throwaway DB.

### Concepts introduced

- **Checkpointer**: saves graph state per `thread_id` after each step → memory across requests, and the ability to
  stop mid-run and continue later.
- **Interrupt (human-in-the-loop)**: `interrupt(value)` pauses the graph and surfaces `value` to the caller;
  `new Command({resume})` continues it, and `interrupt()` returns the resume value. The node re-runs from the start
  on resume → keep side effects after the interrupt.
- **Validate before asking**: only ask the human to confirm things the system would actually accept.

### Verified (no LLM)

- `npm run typecheck`; `npm test` **36/36**:
  - leaveRequest (5): valid EL Dec 22–Jan 2 summary (7 days, 21 → 14) · CL 5 days rejected, 3 OK · EL 3 days with
    2 days' notice rejected, 2 days OK · Priya EL tenure · balance · past date · overlap with pending #4 ·
    weekend-only range · SL backdated OK.
  - graph (5, real graph + scripted model + temp DB): pause → nothing written → new message refused → approve →
    row written (pending, 7 days) → history trimmed to [human, ai] → second resume refused · cancel writes nothing ·
    rule violation returns problems without pausing · same threadId for another employee = separate (no pending,
    resume refused) · 6 turns → last 8 messages kept, starting at "question 3".
  - API (+2): threadId created/reused, non-UUID 400 · confirm 200 / 409 / 400 / 401.
- Demo DB untouched by tests (still 8 requests).
- Live (user): "Apply for earned leave from Dec 22 to Jan 2 for a family trip" → apply_leave → confirmation (7 days,
  21 → 14) → y → request #9 pending; 2 model calls, 4230 in / 234 out. Bot invented "you will be notified" → prompt
  rule added: "Don't promise actions or notifications the tools didn't report." Re-applying the same dates →
  blocked by overlap check ("Overlaps existing pending EL request #9"), no confirmation, nothing saved; 4273 in / 214 out.
  "Apply 1 day casual leave on Nov 3" → confirmation (10 → 9) → n → "nothing was saved"; 4372 in / 153 out. Model
  invented reason "Personal" → `reason` field now described "Only if the user gave one". CL 5-day rejection covered
  by graph/validation tests (not re-run live).

### How to test

CLI (`npm run chat`, Asha):
1. "Apply for earned leave from Dec 22 to Jan 2 for a family trip" → summary (7 days, 21 → 14) → `y` → submitted
   (request id). Then "What's my EL balance?" → 14 available (the new request is pending, so it is reserved).
2. "Apply casual leave Nov 2 to Nov 6" → explains the 3-day CL limit, no confirmation asked.
3. "Apply 1 day casual leave on Nov 3" → `n` → nothing saved.
4. Follow-up memory: "Can I take Dec 22 to Jan 2 off?" then "what about sick leave instead?"

API (after `npm run dev`, PowerShell, `$h` from Stage 5 login):
```powershell
$r = Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/chat -Headers $h -ContentType 'application/json' -Body '{"message":"Apply 1 day casual leave on Nov 4"}'
$r.confirmation
Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/chat/confirm -Headers $h -ContentType 'application/json' -Body (@{threadId=$r.threadId; approved=$true} | ConvertTo-Json)
```
To undo test requests afterwards: `npm run db:reset` (reseeds the synthetic demo data).

---

## Stage 7 — React + MUI chat UI

### What was built ([client/](../client/))

- **Stack**: React 19, MUI 9 (+ Emotion, icons), Vite 8, TypeScript 7, `react-markdown` + `remark-gfm` (bot replies
  use bold and tables). Set up by hand (no create-vite wizard). Scripts: `npm run dev` (:5173), `build`, `typecheck`.
- **Dev proxy**: Vite forwards `/api` to `http://localhost:3001`, so the browser uses one origin (CORS config on the
  server stays as a fallback).
- **Session**: `{token, employee}` kept in React state only (no localStorage) → refresh = log in again; any 401 from
  the API logs the user out (expired token).
- **LoginPage**: email/password form; chips for the 4 synthetic demo accounts fill in email + `Password@123`.
- **ChatPage**:
  - AppBar with name · grade · location, "New conversation" (clears messages + threadId), "Log out".
  - Empty state with 4 suggestion chips following the demo script (balance, Dec 22–Jan 2, carry forward, apply EL).
  - User bubbles right (primary colour), bot bubbles left rendered as Markdown (tables styled).
  - Under each bot reply, a caption: "Tools: calculate_leave, search_policy · 2 model calls · 3.8k tokens" — makes
    the agentic reasoning and token cost visible in the demo.
  - threadId from the first response is sent with every later message (server-side memory).
  - When a response has `confirmation`, a **ConfirmLeaveCard** shows type, dates (e.g. "Tue, 22 Dec 2026"), working
    days, balance before → after, reason; **Submit / Cancel** call `/api/chat/confirm`. The input box is disabled
    (placeholder explains why) until the user decides — matches the server's 409 rule.
  - Enter sends, Shift+Enter = new line, max 1000 chars, "Thinking…" spinner, errors shown as an Alert.
- MUI 9 note: system props like `fontWeight` on Typography were removed → use `sx`.
- Bug found in user testing: `useEffect(() => ref.current?.scrollIntoView(...))` returned scrollIntoView's value (a
  Promise in newer browsers) → React "destroy is not a function" crash after the first message. Fixed with a block
  body. Added an inline SVG favicon (stops the favicon 404).

### Verified (no LLM)

- `npm run typecheck` (client) passes; `vite build` succeeds (single 646 kB JS chunk — fine for a demo).
- Ran API + Vite together: page served (`<title>HR Assist</title>`), `POST /api/login` through the Vite proxy returns
  token + Asha, `/api/chat` without token → 401.
- User-tested in the browser with Claude: working (after the useEffect fix).

### How to test

1. From the project root: `npm run dev` (starts API + UI together) → open http://localhost:5173
3. Click the "Asha · Chennai" chip → Sign in.
4. Click "Can I take Dec 22 to Jan 2 off?" → answer + caption with tools/tokens. Follow up "what about sick leave instead?".
5. "Apply for earned leave from Dec 22 to Jan 2" → confirmation card → Submit → submitted; input disabled while the
   card is showing.
6. "What is Dev Patel's leave balance?" → refusal. Log out → sign in as Priya → "Am I eligible for earned leave?".
7. Narrow the browser to phone width: layout should still fit.
Then `npm run db:reset` (server) to remove test requests.

---

## Stage 8 — Documentation, push, demo

- **[README.md](../README.md)** (for evaluators): capabilities table, quick start (Node ≥ 22.12, `npm run setup`,
  .env table, `npm run dev`, demo accounts), Mermaid **system architecture**, **agent graph**, **apply_leave sequence**
  diagram, tools table, design decisions (math in code, identity, validate-then-confirm, grounded BM25 RAG, token
  token-efficiency table with measured costs, provider-agnostic), security, testing (36 tests), structure, limitations/future.
- **[docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md)**: ~6-minute recording plan following the CLAUDE.md demo steps (+ "not
  covered" and CL-limit extras), timings, what to point out, LangSmith trace moment, ~$0.05 per run.
- Root `package.json` `engines: node >= 22.12` (Vite needs ^20.19 || ≥ 22.12; better-sqlite3 13 needs ≥ 22).
- Full-history secret scan (all commits): no API keys / JWT secrets / .env / .db ever committed.
- Pushed to https://github.com/Muthukumar-ramasamy/HR-Chat-Agent (public). The GitHub repo had an auto-generated
  README commit; merged it with `--allow-unrelated-histories` keeping the project README (no force push). Local
  branch renamed `master` → `main`. Final scan before push: no secrets, no .env/.db/node_modules in any commit.
- **Demo video** recorded automatically with Playwright driving Microsoft Edge (headless) against a private
  instance (API :3101, UI :5174), with on-screen step captions and title/closing cards: ~2:23, WebM, saved outside
  the repo. Frames were reviewed after each take; the takes exposed real issues, fixed in code:
  - **Follow-ups answered from memory** (history trimming removes tool results, so "what about sick leave instead?"
    reused old numbers, did its own subtraction and misquoted the SL certificate rule as "over 3 days"). Fix: prompt
    rule "every question, including follow-ups, needs fresh tool calls ... quote policy limits exactly", with the
    sick-leave follow-up as an explicit example. Verified: follow-up now calls calculate_leave(SL) + search_policy.
  - **"1 pending CL request and 7 pending EL requests"**: model read balance fields as request counts → renamed to
    `used_days` / `pending_days`.
  - **"You'll be notified once your manager responds"** (no notifications exist) persisted despite the prompt rule →
    apply_leave result now carries `note: "No notifications are sent..."`; tool data steers better than prompt text.
  - **Request IDs continued after db:reset** (#18) → reset also clears `sqlite_sequence`.
  - `client/vite.config.ts` proxy target configurable via `API_URL` (default :3001); vite.config.ts excluded from the
    browser tsconfig.
- Pending: submission (video + repo link + README).

---

## Enhancement 1 — Cancel a leave request from chat

- `repo.getLeaveRequest(employeeId, id)` (scoped: another user's id is "not found") and
  `repo.cancelLeaveRequest(employeeId, id)` (UPDATE status = cancelled only if pending/approved; second write in the app).
- `validateCancellation(employee, id)` (hr/leaveRequest.ts): must exist for this user, be pending/approved, and start
  after today (Leave Policy §9) → `CancellationSummary` {request_id, leave_type, leave_name, dates, working_days, status}.
- Tool `cancel_leave({request_id})`: validate → `interrupt({type: "confirm_cancel", ...summary})` → on approval cancel and
  return `available_now` (pending/approved days are freed automatically because balances are derived from requests).
- Confirmation is now a union `Confirmation = LeaveConfirmation | CancelConfirmation` (server tools, runner, CLI, client).
- Prompt: "To cancel, find the request id with get_leave_history, then call cancel_leave (same confirmation)."
- UI: the card shows "Cancel this leave request?" (warning colour) with **Cancel request / Keep it**; CLI asks
  "Cancel this request? (y/n)".
- User-tested (CLI): "Cancel my leave on Oct 16" → get_leave_history → cancel_leave → confirm y → cancelled, CL
  available 11; 3 model calls, 7278 in / 199 out.
- Tests: 38/38 (+1 validation: own/future/pending only, other user's #5 and unknown #999 not found, past request
  already started; +1 graph: pause → nothing changed → approve → status cancelled → CL available +1 → second cancel
  returns a problem without confirmation).

---

## Enhancement 2 — Manager role

- **Shared helpers** moved to [tools/common.ts](../server/src/tools/common.ts) (isoDate, leaveType, Runtime, ConfirmDecision,
  currentEmployee, currentYear, json); employee tools stay in tools/index.ts, manager tools in
  [tools/manager.ts](../server/src/tools/manager.ts).
- **Repo (scoped in SQL to direct reports)**: getDirectReports, getTeamRequests(manager, from, to, statuses) (json_each for
  the status list), getPendingTeamRequests, getTeamRequest(manager, id), decideLeaveRequest(manager, id, approved|rejected)
  (UPDATE only if pending and the employee reports to this manager; third write in the app).
- **Tools** (each calls `currentManager()` → throws "Only managers can use team tools." for employees):
  - `get_team_leave({from_date?, to_date?})` → team names + compact lines "#4 Asha Rao CL 2026-10-16..2026-10-16 1d pending"
    (approved + pending; default today → +1 month).
  - `get_pending_approvals()` → pending lines with applied date and reason.
  - `decide_leave_request({request_id, decision: approve|reject})` → not in team / not pending → problems; else
    `interrupt({type: "confirm_decision", decision, request_id, employee_name, leave..., reason})` → on approval update status.
- **Role-based binding** (graph agent node): looks up the role from state.employeeId each call; employees get `hrTools`,
  managers `hrTools + managerTools`. ToolNode knows all tools; tools re-check the role (defence in depth).
- **Prompt**: `buildSystemPrompt(role)`; managers get one extra rule block and "(except direct reports' leave via the team
  tools)" in the refusal line. Token impact: employee ~423 + 9 tools ~1041 (unchanged by this feature); manager ~486 + 12
  tools ~1362 (~+380).
- **Confirmation union** += DecisionConfirmation (runner, CLI "Approve it? (y/n)", client card: green Approve / red
  Reject, "Not now").
- **UI**: suggestions per role (manager: pending approvals, team leave next month, own balance).
- **User-tested in the browser as Ravi**: pending approvals → approve with confirmation card → team leave view.
- **Dev-server robustness** (found while testing): on Windows, Ctrl+C sometimes left the API running, so a stale API
  (started two days earlier) kept answering with old code. Fixes: (1) server exits with "port 3001 is already in use"
  on EADDRINUSE instead of failing silently; (2) root `predev` / `predev:watch` run
  [scripts/free-ports.cjs](../scripts/free-ports.cjs), which stops leftover processes on 3001/5173 **only if their command
  line points into this project** (other programs are reported, not touched). Verified: leftover PID stopped, `npm run
  dev` starts both, nothing left after stop.
- **Tests 42/42** (+4 graph): manager approves Dev's new request after confirmation (name in card, pending until confirmed);
  rejects Priya's; own request #7 and already-approved #1 → no confirmation, unchanged; employee session calling
  decide_leave_request → tool refuses, unchanged; team queries contain only direct reports, own request not a team request.

---

## Enhancement 3 — Evaluation set (real model)

- **Concept**: unit tests check our code with a scripted fake model; an **eval** checks the real agent + real model
  (tool choice and answer content). It catches prompt regressions such as the follow-up bug found while recording.
- [server/src/eval/cases.ts](../server/src/eval/cases.ts): 13 cases run in order (later ones depend on earlier writes):
  policy citation (§4, 30) · not covered · balance (exact tool, no search_policy) · Dec 22–Jan 2 (7 days, no
  get_holidays, ≤ 3 tool calls) · sick-leave follow-up in the same thread (fresh calculate_leave, ">2 days" rule) ·
  apply → confirm_leave → pending, no "you'll be notified" · CL 5 days rejected without confirmation · privacy refusal
  with no tools · employee cannot use decide_leave_request · Priya eligible from 2027-01-01 · Ravi pending approvals
  (Asha) · Ravi approves #4 (confirm_decision) · Asha cancels Oct 16 (confirm_cancel).
- Checks: tools (all), toolsAny, noTools, notTools, maxToolCalls, confirmation type / none, reply must / must-not regexes.
- [server/src/eval/run.ts](../server/src/eval/run.ts): fresh temp DB (`useTempDb`), `APP_TODAY=2026-10-05`, LangSmith project
  `hr-agent-eval`, confirmations answered from the case, PASS/FAIL table + tokens + estimated cost (Haiku list price),
  exit code 1 on failure. `npm run eval` (root or server); `npm run eval -- --only id1,id2`. Not part of `npm test`.
- First full run: **13/13 passed**, 61,983 in / 1,935 out tokens, ~$0.07.
- Finding → fix: "Dec 22 to Jan 2" called calculate_leave without leave_type plus get_leave_balance and get_holidays ×2.
  calculate_leave now returns `available_by_type` when no leave_type is given and its description says no get_holidays
  is needed. Rerun: get_holidays gone; get_leave_balance still requested **in the same parallel round** (decided before
  any result; costs a small tool result, not a model call) → case allows ≤ 3 tool calls, forbids get_holidays.

---

## Enhancement 4 — Login rate limiting

- [auth/loginLimiter.ts](../server/src/auth/loginLimiter.ts): `createLoginLimiter({maxFailures 5, windowMs 15 min, now})`
  → retryAfter / recordFailure / reset. In memory, keyed by `email|ip`; only failed attempts count; a success resets.
- `POST /api/login`: if blocked → **429** + `Retry-After` + "Too many failed attempts. Try again in N minute(s)." (checked
  before bcrypt, so even the right password waits). `createApp(runner, loginLimiter?)` (injectable for tests).
- Tests 45/45 (+2 unit with fake clock: blocks after max, expires with window, keys independent, success resets;
  +1 API: 2 failures → 429 with Retry-After for that account, another account still logs in).
- Limitation: per-process memory (resets on restart, not shared across instances) → Redis or similar at scale.

---

## Docs and video refresh (after enhancements)

- README: capabilities (cancel + manager rows), demo accounts, scripts (eval, predev cleanup), tools table (9 + 3 manager,
  role-based binding), security (rate limiting, manager scope), token table (employee ~1.5k / manager ~1.85k per call),
  testing (45 tests + eval section), structure, future list (removed what was built).
- Demo video re-recorded (3:39): added 5c cancel (orange card) and 8 manager (pending approvals → approve #9, green card);
  title/closing cards mention manager tools, 45 tests and eval 13/13. Recorder now waits for any confirmation card.
- PDF regenerated (12 pages) with four fresh screenshots: multi-tool + citation, apply card, CL rule + cancel card,
  manager approve card; architecture figure shows 9 + 3 manager tools; committed to docs/.
- DEMO_SCRIPT.md updated with 5c and 8.

---

## Decisions log

| # | Decision | Reason |
|---|---|---|
| D1 | `bcryptjs` instead of `bcrypt` | Pure JS, no native compile on Windows/Node 25; same hash format |
| D2 | Used/pending leave derived from `leave_requests` | Single source of truth, no drift |
| D3 | Leave rules stored in `leave_types` table | Eligibility/calculation math lives in code, not the LLM |
| D4 | ~~Rely on LangChain `maxRetries` for 429 backoff~~ → replaced by D13 | Default handler doesn't retry Gemini 429s |
| D5 | `moduleResolution: "bundler"` + `tsx` | Extensionless imports like a React/Vite project; no build step |
| D6 | No salary data in DB | Not needed for leave features; avoids sensitive-looking fields. Encashment (Stage 2) will take a per-day amount as input or return days only |
| D7 | Seed skips when data exists; reset is explicit | Avoids accidental data loss |
| D8 | Neon (hosted Postgres) setup proposed and declined; stay on SQLite | Keeps scope small; no external services or global installs |
| D9 | Default model `gemini-3.8-flash` | `gemini-2.5-flash` is closed to new API keys (404) |
| D10 | Turn on LangSmith tracing in Stage 1 instead of Stage 8 | User wants to track requests now; also lets us watch tool calling as it's built |
| D11 | Stage 2 uses a hand-written tool loop; LangGraph comes in Stage 3 | Learning: see the raw agent loop before the framework abstracts it |
| D12 | One `calculate_leave` tool with a `calculation` enum (flat schema, not a zod union) | Matches CLAUDE.md's single tool; flat optional fields are more reliable with Gemini than discriminated unions |
| D13 | Custom `onFailedAttempt` Gemini retry handler honoring `retryDelay` | Free tier is 5 RPM; LangChain misclassifies the 429 as hard quota |
| D14 | Encashment returns days only (max 15/yr), no money amounts | Keeps salary data out entirely (see D6) |
| D15 | `APP_TODAY` env override for "today" | Reproducible demo answers ("next week" etc.) |
| D16 | Multi-year leave ranges checked against current-year balance (with a note) | Next year's allocation doesn't exist yet; keep it simple |
| D17 | Unit tests with built-in `node:test` via `tsx --test` | No extra test framework needed |
| D18 | Default LLM = Claude Haiku 4.5 (`claude-haiku-4-5`), Gemini kept as option | Lowest-token Claude model; Haiku 4.5 is the cheapest Claude ($1/$5 per M tokens) |
| D20 | Graph state via `Annotation` (not Zod) | `MessagesZodState` lost the messages type under Zod v4 |
| D21 | System prompt prepended per model call, not stored in state | Keeps saved history small; date always current |
| D22 | History trimming moved into a `trim` graph node (RemoveMessage) | Works the same once a checkpointer stores state (Stage 6) |
| D23 | Policy rules that only exist in prose (CL max 3 days, EL notice, SL certificate) are applied by the LLM via RAG, not coded | Shows policy + data reasoning; keeps code to quantitative rules |
| D24 | Retriever returns nothing unless a distinctive word matches; max 3 hits ≥ 50% of best | Fewer tokens; enables honest "not covered" answers |
| D25 | JWT (HS256, 8h) in `Authorization: Bearer`, no refresh tokens | Simple and stateless; enough for a demo. Refresh/rotation = future |
| D26 | `createApp(runTurn)` dependency injection | API + auth fully tested with a fake agent, no LLM calls |
| D27 | API chat single-turn until Stage 6 | Memory belongs to the checkpointer; never trust client-sent history |
| D28 | Message limit 1000 chars, JSON body 10kb | Limits token cost and protects the server |
| D29 | `MemorySaver` (in-process) checkpointer | SQLite checkpointer package pins better-sqlite3 12 (native, Node 25 risk). Persistent memory = future |
| D30 | Thread key = `employeeId:threadId` | Ownership without a threads table; guessed IDs can't cross users |
| D31 | History capped at 8 messages (4 Q&A) in `trim` | Token rule; long chats don't grow cost |
| D32 | Leave rules enforced in code before the interrupt (incl. CL 3-day, EL notice) | Writes must be deterministic; only ask to confirm valid requests |
| D33 | New message while a confirmation is pending → 409 | Avoids a dangling tool call in history (Anthropic rejects tool_use without tool_result) |
| D34 | Graph tests use a scripted fake model + temp SQLite DB | Full agent flow tested with zero Claude spend |
| D35 | `useTempDb()` helper ([db/tempDb.ts](../server/src/db/tempDb.ts)): tests touching leave data get a fresh seeded temp DB | leaveRequest tests broke after a live test added request #9 to the demo DB; tests must not depend on demo data |
| D36 | Token kept in memory only (no localStorage) | Simple and avoids token theft via injected scripts; refresh = re-login. Cookie-based session = future |
| D37 | Vite dev proxy for `/api` | One origin in the browser; no CORS issues in dev |
| D38 | Show tools + model calls + tokens under each reply | Makes agent reasoning and cost visible in the demo |
| D39 | Root `package.json` with `concurrently` (not npm workspaces) | One command for API + UI without changing how server/ and client/ install their own node_modules |
| D19 | Stage 4 retrieval = local keyword (BM25-style) search, no embeddings | Anthropic has no embeddings API; keyword search needs no API calls/tokens/second provider and suits a small set of well-headed policy docs. Vector search = future enhancement. CLAUDE.md stack updated |

## Open items / reminders

- Stage 4 policy docs must match the `leave_types` rules above (quotas, tenure, carry-forward,
  encashment max 15 days/yr, pro-rata rule "joined on/before 15th counts the month").
- Stage 4: update the system prompt line "HR policy documents are not connected yet".
- (Gemini only) 5 RPM free tier would slow the demo. Options if it hurts: set `APP_TODAY`, record demo in short
  takes, try a model with higher free limits via `LLM_MODEL`, or enable billing on the key.
- Consider a pre-recorded demo user flow with `APP_TODAY` pinned (e.g. 2026-10-05).
- Before every push: check no `.env` or keys are staged (`git status`, `git diff --cached`).
