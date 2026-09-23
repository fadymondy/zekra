// The Touch ID app lock (MH-450). app.tsx mounts <AppLockGate />; Settings ▸
// Security mounts <SecuritySettings />; the vault uses confirmOwner and the
// shared `prompting` flag so its own prompts never count as leaving the app.
export { AppLockGate } from "./app-lock";
export { SecuritySettings } from "./security-settings";
export { confirmOwner, promptTouchId, touchIdAvailable, type Decision } from "./touch-id";
export { lockState, useLockState } from "./lock-state";
