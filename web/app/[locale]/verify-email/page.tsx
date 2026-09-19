"use client"

import { Suspense } from "react"

import { VerifyEmailForm } from "@/components/auth/account-forms"

// Enter the code mailed on sign-up (?email= prefills the address).
export default function Page() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  )
}
