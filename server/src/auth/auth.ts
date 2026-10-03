// Login and JWT handling.
//
// JWT = a signed token: header.payload.signature. The server signs {sub: employeeId} with a
// secret; the browser sends the token back on each request; the server checks the signature
// and expiry. Nobody without the secret can forge or edit the employee ID inside it.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { getEmployee, getLoginRecord, type Employee } from "../hr/repo";

// Compared against when the email doesn't exist, so a wrong email takes as long as a
// wrong password (response time doesn't reveal which emails are registered).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export async function login(email: string, password: string): Promise<Employee | undefined> {
  const record = getLoginRecord(email.trim());
  const ok = await bcrypt.compare(password, record?.password_hash ?? DUMMY_HASH);
  return ok && record ? getEmployee(record.id) : undefined;
}

export function signToken(employeeId: string): string {
  return jwt.sign({}, config.auth.jwtSecret(), {
    subject: employeeId,
    expiresIn: config.auth.tokenTtl as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

// Returns the employee ID from a valid token, or undefined (bad signature, expired, malformed).
export function verifyToken(token: string): string | undefined {
  try {
    const payload = jwt.verify(token, config.auth.jwtSecret(), { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}
