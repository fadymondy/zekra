import { toast } from "sonner"

import { ApiError } from "@/lib/api"
import { trans } from "@/lib/i18n"

/** Toast an API failure in the page's language. */
export function toastError(err: unknown, locale: string) {
  toast.error(err instanceof ApiError ? err.message : trans("common.networkError", locale))
}
