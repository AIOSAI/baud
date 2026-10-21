import type { AppView, PhoneView } from "./phoneView";

interface AppScreensProps {
  view: AppView;
  onOpen: (view: PhoneView) => void;
  onClose: () => void;
}

export default function AppScreens({ view }: AppScreensProps) {
  return <p className="baud-empty">{view.screen}</p>;
}
