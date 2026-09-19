import { redirect } from "next/navigation"

// The auth backend sends admins to /dashboard after social sign-in (AUTH_ADMIN_HOME, fadymondy's
// default); in Zekra that's the admin control panel.
export default async function DashboardRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(`/${locale}/admin`)
}
