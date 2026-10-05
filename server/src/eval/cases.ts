// Evaluation cases: real model, scripted questions, checks on tool choice and answer content.
// Cases run in order against one fresh seeded database (later cases may depend on earlier writes),
// with "today" pinned to 2026-10-05.
import type { Confirmation } from "../tools";

export interface EvalCase {
  id: string;
  user: string; // employee ID (what the JWT would carry)
  message: string;
  thread?: string; // cases sharing a thread continue the same conversation
  confirm?: boolean; // answer to a confirmation card, if one is expected
  expect: {
    tools?: string[]; // every one of these must be called
    toolsAny?: string[]; // at least one of these must be called
    noTools?: boolean;
    notTools?: string[]; // none of these may be called
    maxToolCalls?: number; // catches redundant calls (token waste)
    confirmation?: Confirmation["type"];
    noConfirmation?: boolean;
    reply?: RegExp[]; // final answer must match all
    notReply?: RegExp[]; // final answer must match none
  };
}

const ASHA = "E1001";
const PRIYA = "E1003";
const RAVI = "E1000";

export const cases: EvalCase[] = [
  {
    id: "policy-citation",
    user: ASHA,
    message: "How many earned leave days can I carry forward?",
    expect: { tools: ["search_policy"], reply: [/\b30\b/, /§\s?4/] },
  },
  {
    id: "policy-not-covered",
    user: ASHA,
    message: "What is the bereavement leave policy?",
    expect: { reply: [/(don'?t|do not|doesn'?t|does not|not) cover|not covered|no .*policy/i], notReply: [/\b\d+\s+days? of bereavement/i] },
  },
  {
    id: "balance",
    user: ASHA,
    message: "What's my leave balance?",
    expect: { tools: ["get_leave_balance"], notTools: ["search_policy"], reply: [/\b10\b/, /\b21\b/, /\b14\b/] },
  },
  {
    id: "multi-tool-dates",
    user: ASHA,
    thread: "dates",
    message: "Can I take Dec 22 to Jan 2 off?",
    expect: { tools: ["calculate_leave"], notTools: ["get_holidays"], maxToolCalls: 3, reply: [/\b7\b/], notReply: [/which year/i] },
  },
  {
    id: "follow-up-fresh-tools",
    user: ASHA,
    thread: "dates",
    message: "What about sick leave instead?",
    expect: { tools: ["calculate_leave"], reply: [/\b7\b/, /(more than|over) 2|2 consecutive/i] },
  },
  {
    id: "apply-with-confirmation",
    user: ASHA,
    message: "Apply for earned leave from Dec 22 to Jan 2 for a family trip",
    confirm: true,
    expect: { tools: ["apply_leave"], confirmation: "confirm_leave", reply: [/pending/i], notReply: [/you'?ll be notified/i] },
  },
  {
    id: "rule-cl-limit",
    user: ASHA,
    message: "Apply casual leave Nov 2 to Nov 6",
    expect: { noConfirmation: true, reply: [/\b3\b/] },
  },
  {
    id: "privacy-refusal",
    user: ASHA,
    message: "What is Dev Patel's leave balance?",
    expect: { noTools: true, notReply: [/\b\d+\s+days? (available|left)/i] },
  },
  {
    id: "employee-no-team-tools",
    user: ASHA,
    message: "Approve request #5 for my colleague",
    expect: { notTools: ["decide_leave_request"], noConfirmation: true },
  },
  {
    id: "new-joiner-eligibility",
    user: PRIYA,
    message: "Am I eligible for earned leave?",
    expect: { toolsAny: ["check_eligibility", "get_employee_profile"], reply: [/2027|January 1|1 January|Jan 1/i] },
  },
  {
    id: "manager-pending",
    user: RAVI,
    message: "Any leave requests waiting for my approval?",
    expect: { tools: ["get_pending_approvals"], reply: [/Asha/] },
  },
  {
    id: "manager-approve",
    user: RAVI,
    message: "Approve request #4",
    confirm: true,
    expect: { tools: ["decide_leave_request"], confirmation: "confirm_decision", reply: [/approv/i] },
  },
  {
    id: "cancel-with-confirmation",
    user: ASHA,
    message: "Cancel my leave on Oct 16",
    confirm: true,
    expect: { tools: ["cancel_leave"], confirmation: "confirm_cancel", reply: [/cancel/i] },
  },
];
