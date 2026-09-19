"use client"

import { Suspense } from "react"

import { ForgotPasswordForm } from "@/components/auth/account-forms"

// Mail a reset code, then set a new password with it.
export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  )
}
