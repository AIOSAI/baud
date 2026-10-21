import type { ReactNode } from "react";

/** The box a phone screen mounts in: phone.css contains `.baud-phone-reader` roots inside `.baud-phone-pane`. */
export default function PhonePane({ children }: { children: ReactNode }) {
  return (
    <div className="baud-phone-host">
      <div className="baud-phone-pane">{children}</div>
    </div>
  );
}
