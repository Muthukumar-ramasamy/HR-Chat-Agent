// API tests with a fake agent: no LLM calls, no tokens spent. Uses the seeded SQLite data.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { TurnInput } from "../agent/run";
import { createApp } from "./app";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
process.env.JWT_SECRET = SECRET;

const seen: TurnInput[] = [];
const fakeRunTurn = async (input: TurnInput) => {
  seen.push(input);
  return {
    reply: `echo: ${input.message}`,
    messages: [],
    toolCalls: [],
    usage: { modelCalls: 1, inputTokens: 10, outputTokens: 5 },
  };
};

let server: Server;
let base = "";

before(async () => {
  server = createApp(fakeRunTurn).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function call(path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const loginAs = async (email: string) => (await call("/api/login", { email, password: "Password@123" })).json.token as string;

test("login succeeds with seeded credentials (email case-insensitive)", async () => {
  const { status, json } = await call("/api/login", { email: "Asha.Rao@example.com", password: "Password@123" });
  assert.equal(status, 200);
  assert.equal(json.employee.id, "E1001");
  assert.equal(json.employee.password_hash, undefined);
  assert.equal(jwt.verify(json.token, SECRET).sub, "E1001");
});

test("login fails with the same message for wrong password and unknown email", async () => {
  const wrong = await call("/api/login", { email: "asha.rao@example.com", password: "nope" });
  const unknown = await call("/api/login", { email: "nobody@example.com", password: "Password@123" });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.json.error, unknown.json.error);
});

test("bad request bodies are rejected", async () => {
  assert.equal((await call("/api/login", { email: "asha.rao@example.com" })).status, 400);
  assert.equal((await call("/api/login", "{not json")).status, 400);
});

test("chat requires a valid token", async () => {
  const otherSecret = jwt.sign({}, "some-other-secret-0123456789-abcdefgh", { subject: "E1001" });
  const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, { subject: "E1001" });
  const unsigned = jwt.sign({}, "", { subject: "E1001", algorithm: "none" });
  const unknownUser = jwt.sign({}, SECRET, { subject: "E9999" });
  for (const token of [undefined, "garbage", otherSecret, expired, unsigned, unknownUser]) {
    assert.equal((await call("/api/chat", { message: "hi" }, token)).status, 401, `token: ${token}`);
  }
  assert.equal(seen.length, 0, "agent must not run without a valid token");
});

test("chat uses the employee from the token and ignores any employeeId in the body", async () => {
  const token = await loginAs("asha.rao@example.com");
  const { status, json } = await call("/api/chat", { message: "my balance?", employeeId: "E1002" }, token);
  assert.equal(status, 200);
  assert.equal(json.reply, "echo: my balance?");
  assert.equal(seen.at(-1)?.employeeId, "E1001");
});

test("chat rejects empty and overlong messages", async () => {
  const token = await loginAs("priya.nair@example.com");
  assert.equal((await call("/api/chat", { message: "   " }, token)).status, 400);
  assert.equal((await call("/api/chat", { message: "x".repeat(1001) }, token)).status, 400);
});

test("/api/me returns the logged-in employee", async () => {
  const token = await loginAs("dev.patel@example.com");
  const { status, json } = await call("/api/me", undefined, token);
  assert.equal(status, 200);
  assert.equal(json.employee.id, "E1002");
});
