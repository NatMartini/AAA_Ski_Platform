import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware replacements for next/link and the router hooks. Always import
// these rather than the next/* originals inside [locale] routes, otherwise
// navigation silently drops the locale prefix.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
