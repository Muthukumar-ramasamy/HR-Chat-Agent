import { useState } from "react";
import type { Employee } from "./api";
import ChatPage from "./ChatPage";
import LoginPage from "./LoginPage";

export interface Session {
  token: string;
  employee: Employee;
}

// The token lives only in memory: a page refresh means logging in again. Nothing is
// written to localStorage, so another script on the page can't read a saved token.
export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  return session ? (
    <ChatPage session={session} onLogout={() => setSession(null)} />
  ) : (
    <LoginPage onLogin={setSession} />
  );
}
