import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { LeaveConfirmation } from "./api";

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Shown when apply_leave pauses the agent. Nothing is saved until the user presses Submit.
export default function ConfirmLeaveCard({
  confirmation: c,
  onDecide,
}: {
  confirmation: LeaveConfirmation;
  onDecide: (approved: boolean) => void;
}) {
  const rows: [string, string][] = [
    ["Leave type", `${c.leave_name} (${c.leave_type})`],
    ["From", formatDate(c.start_date)],
    ["To", formatDate(c.end_date)],
    ["Working days", String(c.working_days)],
    ["Balance", `${c.balance_before} → ${c.balance_after} days`],
    ...(c.reason ? ([["Reason", c.reason]] as [string, string][]) : []),
  ];

  return (
    <Card variant="outlined" sx={{ alignSelf: "flex-start", width: "100%", maxWidth: 420, borderColor: "primary.main" }}>
      <CardContent>
        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
          Confirm leave request
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
          The request goes to your manager for approval after you submit.
        </Typography>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2 }}>
        <Button variant="contained" onClick={() => onDecide(true)}>
          Submit
        </Button>
        <Button onClick={() => onDecide(false)}>Cancel</Button>
      </CardActions>
    </Card>
  );
}
