"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "./usage-tracking";
export default function VisitTracker() {
  const pathname = usePathname();
  useEffect(() => { track("page_view", pathname === "/pdf-seal" ? "pdf-seal" : "site"); }, [pathname]);
  return null;
}
