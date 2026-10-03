import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Light and dark palettes; MUI follows the OS setting.
const theme = createTheme({
  colorSchemes: { light: true, dark: true },
  shape: { borderRadius: 10 },
  palette: { primary: { main: "#3f51b5" } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
