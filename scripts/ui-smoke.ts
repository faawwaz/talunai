import { runUiSmoke } from "../tests/ui.browser";

/** Explicit opt-in runner. No participant keys or session cookies are written to reports. */
await runUiSmoke();
