// HTTP API.
//   POST /api/login  {email, password}  -> {token, employee}
//   GET  /api/me     (Bearer token)      -> {employee}
//   POST /api/chat   (Bearer token) {message} -> {reply, toolCalls, usage}
//
// The agent runner is passed in, so tests can use a fake one (no LLM calls).
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { RunTurn } from "../agent/run";
import { login, signToken, verifyToken } from "../auth/auth";
import { config } from "../config";
import { getEmployee, type Employee } from "../hr/repo";

const LoginBody = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });
const ChatBody = z.object({ message: z.string().trim().min(1).max(config.server.maxMessageChars) });

// Only what the UI needs: no internal IDs of managers, no hashes.
const publicEmployee = (e: Employee) => ({
  id: e.id,
  name: e.name,
  role: e.role,
  grade: e.grade,
  department: e.department,
  location: e.location,
});

// Reads "Authorization: Bearer <jwt>". On success the verified employee is in res.locals —
// the ONLY place request handlers get an employee ID from.
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  const employeeId = scheme === "Bearer" && token ? verifyToken(token) : undefined;
  const employee = employeeId ? getEmployee(employeeId) : undefined;
  if (!employee) {
    res.status(401).json({ error: "Not logged in or session expired." });
    return;
  }
  res.locals.employee = employee;
  next();
}

export function createApp(runTurn: RunTurn) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.server.corsOrigin }));
  app.use(express.json({ limit: "10kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/login", async (req, res) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }
    const employee = await login(body.data.email, body.data.password);
    if (!employee) {
      // Same message for unknown email and wrong password.
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    res.json({ token: signToken(employee.id), employee: publicEmployee(employee) });
  });

  app.get("/api/me", requireAuth, (_req, res) => {
    res.json({ employee: publicEmployee(res.locals.employee) });
  });

  app.post("/api/chat", requireAuth, async (req, res) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: `Message must be 1-${config.server.maxMessageChars} characters.` });
      return;
    }
    const employee: Employee = res.locals.employee;
    // Any employeeId in the request body is ignored; identity comes only from the token.
    // Stage 6 adds conversation memory (thread_id + checkpointer); for now each request is one turn.
    const result = await runTurn({ employeeId: employee.id, history: [], message: body.data.message });
    console.log(
      `[chat] ${employee.id} tools=${result.toolCalls.map((t) => t.name).join(",") || "-"} ` +
        `tokens=${result.usage.inputTokens}/${result.usage.outputTokens}`,
    );
    res.json({ reply: result.reply, toolCalls: result.toolCalls, usage: result.usage });
  });

  // Malformed JSON and unexpected errors. Details go to the server log, not the client.
  app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }
    console.error("[error]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return app;
}
