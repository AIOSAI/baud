import type { CardView, PhoneView } from "./phoneView";

interface CardScreensProps {
  view: CardView;
  onOpen: (view: PhoneView) => void;
  onClose: () => void;
}

export default function CardScreens({ view }: CardScreensProps) {
  return <p className="baud-empty">{view.screen}</p>;
}
