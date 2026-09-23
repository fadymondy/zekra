import { AuthSessionReturn } from "@/features/social/auth-return";

// zekra://auth/github — the browser sign-in returns here (src/features/social/auth-return.tsx).
export default function GitHubReturn() {
  return <AuthSessionReturn provider="github" />;
}
