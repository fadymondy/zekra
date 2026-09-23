// Mahaam SDK (feedback reporter + error monitor). crash.ts imports the pieces it
// needs directly (./diagnostics, ./monitor, ./report-sheet) to avoid an import cycle
// through analytics.
export { MahaamReportHost, openReport } from "./report-host";
export { feedbackEnabled } from "./config";
export { useShakeSetting } from "./shake";
