"use client"

import { Suspense } from "react"

import { RegisterForm } from "@/components/auth/account-forms"

// Create an account; the server then mails a code to verify the address.
export default function Page() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}
