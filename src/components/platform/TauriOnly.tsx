import type { PropsWithChildren } from "react";

export function TauriOnly({ children }: PropsWithChildren) {
  if (__IS_WEB__) return null;
  return <>{children}</>;
}
