// HTTP API.
//   POST /api/login  {email, password}  -> {token, employee}
//   GET  /api/me     (Bearer token)      -> {employee}
//   POST /api/chat          (Bearer) {message, threadId?}  -> {threadId, reply, confirmation?, toolCalls, usage}
//   POST /api/chat/confirm  (Bearer) {threadId, approved}  -> same shape (resumes a paused apply_leave)
//
// The agent runner is passed in, so tests can use a fake one (no LLM calls).
import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { ConfirmationStateError, type TurnInput, type TurnResult, type TurnRunner } from "../agent/run";
import { login, signToken, verifyToken } from "../auth/auth";
import { createLoginLimiter, type LoginLimiter } from "../auth/loginLimiter";
import { config } from "../config";
import { getEmployee, type Employee } from "../hr/repo";

const LoginBody = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });
const ThreadId = z.uuid();
const ChatBody = z.object({
  message: z.string().trim().min(1).max(config.server.maxMessageChars),
  threadId: ThreadId.optional(), // omit to start a new conversation
});
const ConfirmBody = z.object({ threadId: ThreadId, approved: z.boolean() });

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

// The login limiter is injectable so tests can use a small limit and a fake clock.
export function createApp(runner: TurnRunner, loginLimiter: LoginLimiter = createLoginLimiter()) {
  // Runs a turn and sends the response. 409 = confirmation state mismatch (e.g. new message
  // while a leave request is waiting for confirmation).
  async function respond(res: Response, input: TurnInput) {
    let result: TurnResult;
    try {
      result = await runner.run(input);
    } catch (err) {
      if (err instanceof ConfirmationStateError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
    console.log(
      `[chat] ${input.employeeId} tools=${result.toolCalls.map((t) => t.name).join(",") || "-"} ` +
        `tokens=${result.usage.inputTokens}/${result.usage.outputTokens}${result.confirmation ? " (awaiting confirmation)" : ""}`,
    );
    res.json({ threadId: input.threadId, ...result });
  }

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
    const key = `${body.data.email.trim().toLowerCase()}|${req.ip}`;
    const wait = loginLimiter.retryAfter(key);
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` });
      return;
    }
    const employee = await login(body.data.email, body.data.password);
    if (!employee) {
      loginLimiter.recordFailure(key);
      // Same message for unknown email and wrong password.
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    loginLimiter.reset(key);
    res.json({ token: signToken(employee.id), employee: publicEmployee(employee) });
  });

  app.get("/api/me", requireAuth, (_req, res) => {
    res.json({ employee: publicEmployee(res.locals.employee) });
  });

  app.post("/api/chat", requireAuth, async (req, res) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: `Message must be 1-${config.server.maxMessageChars} characters; threadId must be a UUID.` });
      return;
    }
    // Identity comes only from the token; any employeeId in the body is ignored.
    const employee: Employee = res.locals.employee;
    await respond(res, { employeeId: employee.id, threadId: body.data.threadId ?? randomUUID(), message: body.data.message });
  });

  app.post("/api/chat/confirm", requireAuth, async (req, res) => {
    const body = ConfirmBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "threadId (UUID) and approved (boolean) are required." });
      return;
    }
    const employee: Employee = res.locals.employee;
    await respond(res, { employeeId: employee.id, threadId: body.data.threadId, resume: { approved: body.data.approved } });
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
