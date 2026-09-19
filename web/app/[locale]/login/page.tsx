"use client"

import { Suspense } from "react"

import { LoginForm } from "@/components/auth/login-form"

// Sign in: password, emailed code, two-factor step, and the advertised providers.
export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
