import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Confirmation } from "./api";

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Color = "primary" | "warning" | "success" | "error";

// Title, colour, buttons and extra rows for each kind of confirmation.
function describe(c: Confirmation): { title: string; color: Color; yes: string; no: string; note: string; extra: [string, string][] } {
  switch (c.type) {
    case "confirm_leave":
      return {
        title: "Confirm leave request",
        color: "primary",
        yes: "Submit",
        no: "Cancel",
        note: "The request goes to your manager for approval after you submit.",
        extra: [["Balance", `${c.balance_before} → ${c.balance_after} days`], ...(c.reason ? ([["Reason", c.reason]] as [string, string][]) : [])],
      };
    case "confirm_cancel":
      return {
        title: "Cancel this leave request?",
        color: "warning",
        yes: "Cancel request",
        no: "Keep it",
        note: "The days go back to your balance once cancelled.",
        extra: [["Request", `#${c.request_id} (${c.status})`]],
      };
    case "confirm_decision": {
      const approve = c.decision === "approve";
      return {
        title: `${approve ? "Approve" : "Reject"} ${c.employee_name}'s request?`,
        color: approve ? "success" : "error",
        yes: approve ? "Approve" : "Reject",
        no: "Not now",
        note: approve ? "The days stay deducted from their balance." : "The days go back to their balance.",
        extra: [["Request", `#${c.request_id}`], ...(c.reason ? ([["Reason", c.reason]] as [string, string][]) : [])],
      };
    }
  }
}

// Shown when a write tool pauses the agent. Nothing changes until the user confirms.
export default function ConfirmLeaveCard({
  confirmation: c,
  onDecide,
}: {
  confirmation: Confirmation;
  onDecide: (approved: boolean) => void;
}) {
  const d = describe(c);
  const rows: [string, string][] = [
    ["Leave type", `${c.leave_name} (${c.leave_type})`],
    ["From", formatDate(c.start_date)],
    ["To", formatDate(c.end_date)],
    ["Working days", String(c.working_days)],
    ...d.extra,
  ];

  return (
    <Card variant="outlined" sx={{ alignSelf: "flex-start", width: "100%", maxWidth: 420, borderColor: `${d.color}.main` }}>
      <CardContent>
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
          {d.title}
        </Typography>
        <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.5, m: 0 }}>
          {rows.map(([label, value]) => (
            <Box key={label} sx={{ display: "contents" }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          {d.note}
        </Typography>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2 }}>
        <Button variant="contained" color={d.color} onClick={() => onDecide(true)}>
          {d.yes}
        </Button>
        <Button onClick={() => onDecide(false)}>{d.no}</Button>
      </CardActions>
    </Card>
  );
}
