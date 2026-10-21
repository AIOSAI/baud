import AppScreens from "./AppScreens";
import CardScreens from "./CardScreens";
import PhonePane from "./PhonePane";
import { isAppView, type PhoneView } from "./phoneView";

interface PhoneTabProps {
  view: PhoneView;
  /** Opens or fronts another phone tab (a mail row's message, a card door from inside a screen). */
  onOpen: (view: PhoneView) => void;
  onClose: () => void;
}

/** One workbench tab holding a phone screen. Mounted only while in front: the screens refetch on mount. */
export default function PhoneTab({ view, onOpen, onClose }: PhoneTabProps) {
  return (
    <PhonePane>
      {isAppView(view) ? (
        <AppScreens view={view} onOpen={onOpen} onClose={onClose} />
      ) : (
        <CardScreens view={view} onOpen={onOpen} onClose={onClose} />
      )}
    </PhonePane>
  );
}
