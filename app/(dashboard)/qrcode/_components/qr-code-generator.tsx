"use client";

import * as React from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Button, Card, CardBody, Field, Textarea, useToast } from "@/components/ui";
import { DownloadIcon } from "@/components/ui/icons";

const MAX_LENGTH = 2000;
const QR_SIZE = 256;

export function QrCodeGenerator() {
  const [text, setText] = React.useState("");
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const toast = useToast();

  const trimmed = text.trim();
  const hasValue = trimmed.length > 0;

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "qr-code.png";
    a.click();
    toast.success("Downloaded qr-code.png");
  };

  return (
    <Card>
      <CardBody className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <Field
          label="Text or URL"
          htmlFor="qr-text"
          hint={`${text.length}/${MAX_LENGTH} characters`}
        >
          <Textarea
            id="qr-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_LENGTH}
            rows={8}
            placeholder="https://example.com"
          />
        </Field>

        <div className="flex flex-col items-center gap-4">
          <div className="flex aspect-square w-full max-w-[256px] items-center justify-center rounded-[var(--radius-md)] border border-border bg-white p-4">
            {hasValue ? (
              <QRCodeCanvas
                ref={canvasRef}
                value={trimmed}
                size={QR_SIZE}
                marginSize={2}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-border-strong p-4 text-center text-[13px] text-muted">
                Enter text to generate a QR code
              </div>
            )}
          </div>

          <Button
            variant="gradient"
            className="w-full sm:w-auto"
            disabled={!hasValue}
            onClick={handleDownload}
          >
            <DownloadIcon size={16} />
            Download PNG
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
