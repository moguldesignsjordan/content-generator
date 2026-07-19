import { ScreenHeader } from "../_components/screen-header";
import { QrCodeGenerator } from "./_components/qr-code-generator";

export default function QrCodePage() {
  return (
    <>
      <ScreenHeader
        title="QR Code Generator"
        subtitle="Turn a link or text into a scannable QR code."
      />
      <QrCodeGenerator />
    </>
  );
}
