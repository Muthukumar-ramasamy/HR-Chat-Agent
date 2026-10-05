import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError, confirmLeave, sendMessage, type ChatResponse, type Confirmation } from "./api";
import type { Session } from "./App";
import ConfirmLeaveCard from "./ConfirmLeaveCard";

type Message =
  | { role: "user"; text: string }
  | { role: "bot"; text: string; toolCalls: ChatResponse["toolCalls"]; usage: ChatResponse["usage"] }
  | { role: "error"; text: string };

// Starter questions that walk through the demo script.
const SUGGESTIONS = {
  employee: [
    "What's my leave balance?",
    "Can I take Dec 22 to Jan 2 off?",
    "How many earned leave days can I carry forward?",
    "Apply for earned leave from Dec 22 to Jan 2",
  ],
  manager: [
    "Any leave requests waiting for my approval?",
    "Who on my team is on leave in the next month?",
    "What's my leave balance?",
  ],
};

// The user's line shown after they answer a confirmation card.
const DECISION_TEXT: Record<Confirmation["type"], [string, string]> = {
  confirm_leave: ["Submit the request", "Don't submit"],
  confirm_cancel: ["Cancel the request", "Keep the request"],
  confirm_decision: ["Confirm", "Not now"],
};

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function ChatPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string>();
  const [pending, setPending] = useState<Confirmation>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Braces matter: an effect may only return a cleanup function, and scrollIntoView can
  // return a Promise in newer browsers.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, busy]);

  const add = (m: Message) => setMessages((prev) => [...prev, m]);

  async function call(request: () => Promise<ChatResponse>) {
    setBusy(true);
    try {
      const r = await request();
      setThreadId(r.threadId);
      if (r.confirmation) setPending(r.confirmation);
      else add({ role: "bot", text: r.reply, toolCalls: r.toolCalls, usage: r.usage });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onLogout(); // token expired
      add({ role: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function send(text: string) {
    const message = text.trim();
    if (!message || busy || pending) return;
    setInput("");
    add({ role: "user", text: message });
    void call(() => sendMessage(session.token, message, threadId));
  }

  function decide(approved: boolean) {
    if (!threadId) return;
    setPending(undefined);
    if (pending) add({ role: "user", text: DECISION_TEXT[pending.type][approved ? 0 : 1] });
    void call(() => confirmLeave(session.token, threadId, approved));
  }

  function newChat() {
    setMessages([]);
    setThreadId(undefined);
    setPending(undefined);
  }

  const { employee } = session;

  return (
    <Box sx={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static" elevation={0} color="default" sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 1 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h1" noWrap>
              HR Assist
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="p">
              {employee.name} · {employee.grade} · {employee.location}
            </Typography>
          </Box>
          <Tooltip title="New conversation">
            <IconButton onClick={newChat} disabled={busy} aria-label="New conversation">
              <AddCommentOutlinedIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Log out">
            <IconButton onClick={onLogout} aria-label="Log out">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, overflowY: "auto", px: 2, py: 3 }}>
        <Stack spacing={2} sx={{ maxWidth: 760, mx: "auto" }}>
          {messages.length === 0 && (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography variant="h6" gutterBottom>
                Hi {employee.name.split(" ")[0]}, how can I help?
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Ask about your leave, holidays or HR policy. Try one of these:
              </Typography>
              <Stack direction="row" useFlexGap spacing={1} sx={{ justifyContent: "center", flexWrap: "wrap" }}>
                {SUGGESTIONS[employee.role].map((s) => (
                  <Chip key={s} label={s} variant="outlined" onClick={() => send(s)} />
                ))}
              </Stack>
            </Box>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {pending && <ConfirmLeaveCard confirmation={pending} onDecide={decide} />}

          {busy && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
              <CircularProgress size={16} />
              <Typography variant="body2">Thinking…</Typography>
            </Stack>
          )}
          <div ref={bottomRef} />
        </Stack>
      </Box>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        sx={{ borderTop: 1, borderColor: "divider", p: 1.5 }}
      >
        <Stack direction="row" spacing={1} sx={{ maxWidth: 760, mx: "auto", alignItems: "flex-end" }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            size="small"
            placeholder={pending ? "Answer the confirmation above first" : "Ask about leave, holidays or policy…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            disabled={!!pending}
            slotProps={{ htmlInput: { maxLength: 1000, "aria-label": "Message" } }}
          />
          <IconButton type="submit" color="primary" disabled={busy || !!pending || !input.trim()} aria-label="Send">
            <SendIcon />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "error") return <Alert severity="error">{message.text}</Alert>;

  const isUser = message.role === "user";
  return (
    <Box sx={{ alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: { xs: "92%", sm: "80%" } }}>
      <Paper
        elevation={0}
        sx={{
          px: 2,
          py: 1.25,
          bgcolor: isUser ? "primary.main" : "action.hover",
          color: isUser ? "primary.contrastText" : "text.primary",
          "& p": { my: 0.5 },
          "& ul, & ol": { my: 0.5, pl: 2.5 },
          "& table": { borderCollapse: "collapse", my: 1, fontSize: 14 },
          "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.5, textAlign: "left" },
        }}
      >
        {isUser ? <Typography sx={{ whiteSpace: "pre-wrap" }}>{message.text}</Typography> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>}
      </Paper>
      {message.role === "bot" && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, ml: 0.5 }}>
          {message.toolCalls.length ? `Tools: ${[...new Set(message.toolCalls.map((t) => t.name))].join(", ")} · ` : "No tools · "}
          {message.usage.modelCalls} model call{message.usage.modelCalls === 1 ? "" : "s"} ·{" "}
          {formatTokens(message.usage.inputTokens + message.usage.outputTokens)} tokens
        </Typography>
      )}
    </Box>
  );
}
