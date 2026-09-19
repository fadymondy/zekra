/** The product name in the page's language: ذكرة on /ar, Zekra everywhere else. */
export function brandName(locale: string | null | undefined): string {
  return locale === "ar" ? "ذكرة" : "Zekra"
}
