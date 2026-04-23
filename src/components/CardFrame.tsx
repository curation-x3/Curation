import { type ReactNode } from "react";

interface CardFrameProps {
  chatActive: boolean;
  children: ReactNode;
  label?: string;
  /** Force the frame to render even when chat is inactive. */
  force?: boolean;
}

export function CardFrame({ chatActive, children, label, force }: CardFrameProps) {
  if (!chatActive && !force) {
    return <>{children}</>;
  }

  return (
    <div className="card-frame">
      {label && <div className="card-frame-label">{label}</div>}
      {children}
    </div>
  );
}
