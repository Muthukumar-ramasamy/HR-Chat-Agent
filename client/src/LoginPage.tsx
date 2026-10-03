import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent } from "react";
import { login } from "./api";
import type { Session } from "./App";

// Synthetic seed accounts (see server/src/db/seed.ts). Fictional people, demo only.
const DEMO_PASSWORD = "Password@123";
const DEMO_ACCOUNTS = [
  { email: "asha.rao@example.com", label: "Asha · Chennai" },
  { email: "dev.patel@example.com", label: "Dev · Bengaluru" },
  { email: "priya.nair@example.com", label: "Priya · new joiner" },
  { email: "ravi.kumar@example.com", label: "Ravi · manager" },
];

export default function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await login(email, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 2 }}>
      <Paper component="form" onSubmit={submit} variant="outlined" sx={{ p: { xs: 3, sm: 4 }, width: "100%", maxWidth: 420 }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
              HR Assist
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Leave, holidays and HR policy questions for Acme Corp (fictional).
            </Typography>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          <Box>
            <Typography variant="caption" color="text.secondary">
              Demo accounts (synthetic data, password {DEMO_PASSWORD}):
            </Typography>
            <Stack direction="row" useFlexGap spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {DEMO_ACCOUNTS.map((a) => (
                <Chip
                  key={a.email}
                  label={a.label}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
