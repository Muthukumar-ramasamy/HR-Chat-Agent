# HR Chat Agent — Agentic AI Assessment

> **Progress log:** read [docs/PROGRESS.md](docs/PROGRESS.md) at the start of every session.
> It records what each stage built, decisions made, and the next action. Update it at the
> end of every stage.

## Goal
Build an HR Chat Agent for the Agentic AI program first-round assessment.
Deadline: Tue Oct 6, 1:00 PM. Target: submit by Sunday night (Monday is unavailable).
Submission: demo video, public GitHub repo, architecture documentation.

Evaluation criteria: implementation quality, agentic approach, framework usage,
tool integration, architecture, completeness.

## Developer context
- I'm a React/TypeScript frontend developer, new to building agents.
- I want to LEARN while building: explain each new concept briefly as we implement it
  (tool calling, agent loop, RAG, state, checkpointers, interrupts).
- Build in small stages. After each stage, it must run, and I test it before moving on.

## Stack
- Language: TypeScript (Node.js) end to end
- Agent framework: LangGraph.js (@langchain/langgraph)
- LLM: Google Gemini Flash via free tier (@langchain/google-genai), key from Google AI Studio
- Embeddings: Gemini embedding model
- Vector store: LangChain in-memory vector store (rebuilt from policy docs at startup)
- Database: SQLite (better-sqlite3) with SYNTHETIC seed data only
- Backend: Express API
- Frontend: React + MUI (Vite), minimal chat UI
- Auth: JWT login against seeded users (bcrypt-hashed passwords)
- Tracing: LangSmith (free tier) to show agent reasoning in the demo

## Agent tools
- search_policy(query): RAG over HR policy documents; answers must cite doc + section
- get_leave_balance(leave_type?)
- get_leave_history(from, to)
- get_employee_profile(): tenure, grade, location, joining date
- get_holidays(year, location)
- calculate_leave(...): deterministic code for working days (excluding weekends/holidays),
  pro-rata accrual, encashment, LOP. Math lives in code, never in the LLM.
- check_eligibility(leave_type): e.g. tenure requirements
- apply_leave(...): pauses with a LangGraph interrupt for user confirmation before writing

## Key design rules
- employee_id comes ONLY from the verified JWT and is injected into agent state.
  Tools never accept an employee ID from the user's message. Requests for other
  employees' data must be refused.
- If the policy docs don't cover a question, the agent says so instead of guessing.
- Conversation memory via a LangGraph checkpointer keyed by thread_id.
- Retry with backoff on Gemini 429 (rate limit) errors; free tier has tight limits.
- Model provider must be swappable in one place (config), in case we move to Claude/OpenAI.
- Minimize tokens in everything: lean prompts and tool descriptions, compact tool results,
  no redundant tool calls, trimmed history, short answers, cheapest adequate model
  (currently Claude Haiku 4.5). Report token impact of changes.

## Security / data rules
- Only synthetic employees, balances, and sample policy docs. No real HR or company data.
- API keys only in .env (gitignored). Commit a .env.example with placeholder values.
- Never commit secrets; check before every push.

## Plan
### Saturday — agent core
1. Project setup, SQLite schema + synthetic seed data, bare Gemini chat loop (CLI)
2. HR tools + tool calling
3. LangGraph agent wiring all tools
4. search_policy RAG over policy docs
Milestone: CLI answers "Can I take 5 days off next week?" by combining policy + data.

### Sunday — product + submission
5. Login + JWT, employee_id injected into state
6. Conversation memory + apply_leave with confirmation (interrupt)
7. React + MUI chat UI connected to the backend
8. LangSmith tracing, README with architecture diagram (Mermaid) and design decisions,
   record demo, push to GitHub, submit

Scope rule: if a stage overruns by more than an hour, keep it basic and move on.

### Stretch goals (only if time remains)
- Manager role with team leave view
(Otherwise list under "Future enhancements" in the README.)

## Demo script
1. Pure policy question → answer with citation
2. "What's my leave balance?" → single tool call
3. "Can I take Dec 22 – Jan 2 off?" → multi-tool reasoning, show the trace
4. Follow-up ("what about sick leave instead?") → context handling
5. Apply for leave → confirmation step
6. Ask for another employee's data → refusal