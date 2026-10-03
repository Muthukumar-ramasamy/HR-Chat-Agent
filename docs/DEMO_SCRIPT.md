# Demo script (about 6 minutes)

Recording checklist:
- `npm run db:reset` (clean synthetic data), then `npm run dev`. Do not use `dev:watch`: a restart clears chat memory.
- Optional: set `APP_TODAY=2026-10-05` in `server/.env` so dates match this script exactly.
- Browser at http://localhost:5173, and LangSmith open on the `hr-agent` project in a second tab.
- Cost: one full run is about 8 questions, roughly $0.05 of Claude credit.

| # | Time | Do | Point out |
|---|---|---|---|
| 0 | 0:00–0:40 | Show the README architecture diagram. Log in with the **Asha · Chennai** chip | Synthetic data; identity comes from a JWT; the agent never accepts an employee ID |
| 1 | 0:40–1:30 | Ask: *How many earned leave days can I carry forward?* | Policy answer with a citation *(Leave Policy §4)*; caption shows `search_policy` |
| 1b | | Ask: *What is the bereavement leave policy?* | It says the policy doesn't cover it instead of guessing |
| 2 | 1:30–2:00 | Ask: *What's my leave balance?* | One tool call; token count in the caption |
| 3 | 2:00–3:15 | Ask: *Can I take Dec 22 to Jan 2 off?* Switch to LangSmith and open the trace | Multi-tool reasoning: `calculate_leave` + `search_policy` in parallel; 7 working days (Christmas and New Year excluded); the math comes from code. In the trace: agent → tools → agent → trim |
| 4 | 3:15–3:45 | Ask: *What about sick leave instead?* | Memory: same dates reused without restating them |
| 5 | 3:45–4:45 | Ask: *Apply for earned leave from Dec 22 to Jan 2 for a family trip* → card appears → **Submit** | Validation runs first, then a LangGraph interrupt pauses the graph; input is disabled; nothing is written until Submit; request saved as pending |
| 5b | | Ask: *Apply casual leave Nov 2 to Nov 6* | Rule enforced in code (CL max 3 consecutive days): explained, no confirmation shown |
| 6 | 4:45–5:15 | Ask: *What is Dev Patel's leave balance?* | Refusal with no tool calls |
| 7 | 5:15–6:00 | Log out → **Priya · new joiner** → *Am I eligible for earned leave?* | Not until 2027-01-01 (6-month tenure rule); same agent, different user |

Wrap-up line: "LangGraph agent with 8 tools on Claude Haiku 4.5, deterministic leave math, cited policy search,
human-in-the-loop writes, about half a cent per question, 36 automated tests with no LLM calls."

After recording: `npm run db:reset` again if you want clean data.
