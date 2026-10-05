// Thin client for the Express API. Types mirror server/src/server/app.ts responses.

export interface Employee {
  id: string;
  name: string;
  role: "employee" | "manager";
  grade: string;
  department: string;
  location: string;
}

export interface LeaveConfirmation {
  type: "confirm_leave";
  leave_type: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  working_days: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
}

export interface CancelConfirmation {
  type: "confirm_cancel";
  request_id: number;
  leave_type: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  working_days: number;
  status: string;
}

export interface DecisionConfirmation {
  type: "confirm_decision";
  decision: "approve" | "reject";
  request_id: number;
  employee_name: string;
  leave_type: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string | null;
}

export type Confirmation = LeaveConfirmation | CancelConfirmation | DecisionConfirmation;

export interface ChatResponse {
  threadId: string;
  reply: string;
  confirmation?: Confirmation;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  usage: { modelCalls: number; inputTokens: number; outputTokens: number };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const login = (email: string, password: string) =>
  post<{ token: string; employee: Employee }>("/api/login", { email, password });

export const sendMessage = (token: string, message: string, threadId?: string) =>
  post<ChatResponse>("/api/chat", { message, threadId }, token);

export const confirmLeave = (token: string, threadId: string, approved: boolean) =>
  post<ChatResponse>("/api/chat/confirm", { threadId, approved }, token);
