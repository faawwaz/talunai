"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Marketing content does not need wallet libraries, session queries or an
// application-origin redirect. Product routes retain the same shared provider.
const ProductProviders = dynamic(() =>
  import("./provider").then((module) => module.AppProviders),
);

export function RouteProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return children;
  return <ProductProviders>{children}</ProductProviders>;
}
