// Helpers shared by the employee tools (index.ts) and the manager tools (manager.ts).
import type { ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentStateType } from "../agent/state";
import { today } from "../hr/dates";
import * as repo from "../hr/repo";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const leaveType = z.enum(["CL", "SL", "EL"]); // meanings are in the system prompt

export type Runtime = ToolRuntime<AgentStateType>;

// The answer the app resumes an interrupt with.
export const ConfirmDecision = z.object({ approved: z.boolean() });

export function currentEmployee(runtime: Runtime): repo.Employee {
  const id = runtime?.state?.employeeId;
  if (typeof id !== "string" || !id) throw new Error("No authenticated employee in this session.");
  const employee = repo.getEmployee(id);
  if (!employee) throw new Error("Authenticated employee not found.");
  return employee;
}

export const currentYear = () => Number(today().slice(0, 4));

// Tool results go back to the model as input tokens: keep them compact.
export const json = (value: unknown) => JSON.stringify(value);
