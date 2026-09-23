import { AuthSessionReturn } from "@/features/social/auth-return";

// zekra://auth/google — the browser sign-in returns here (src/features/social/auth-return.tsx).
export default function GoogleReturn() {
  return <AuthSessionReturn provider="google" />;
}
