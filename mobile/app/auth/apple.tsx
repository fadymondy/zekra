import { AuthSessionReturn } from "@/features/social/auth-return";

// zekra://auth/apple — Apple's browser sign-in (Android) returns here (src/features/social/auth-return.tsx).
export default function AppleReturn() {
  return <AuthSessionReturn provider="apple" />;
}
