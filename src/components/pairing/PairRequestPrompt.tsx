import React, { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "../common/Button";
import { StorageService } from "../../services/storageService";

type PendingRequest = { request_id: string; device_id: string; device_name: string };

/**
 * Asks the person at this device whether another device may connect.
 *
 * This replaces reading a PIN off one screen and typing it into the other:
 * pressing Allow here is the same proof that someone is standing at this
 * device. Native apps only — a browser never receives pairing requests.
 * See D-090.
 */
export const PairRequestPrompt: React.FC<{ onPaired?: () => void }> = ({ onPaired }) => {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // ponytail: polls every 1.5 s; an event from Rust if this ever shows up in a profile.
    const timer = setInterval(async () => {
      const pending = await StorageService.getPendingPairRequest();
      setRequest((current) => (current?.request_id === pending?.request_id ? current : pending));
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  if (!request) return null;

  const answer = async (allow: boolean) => {
    try {
      await StorageService.answerPairRequest(request.request_id, allow);
      setRequest(null);
      setError(null);
      if (allow) onPaired?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none">
      <div
        className="w-full max-w-sm bg-vault-card/95 border border-vault-border rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pair-request-title"
      >
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-vault-elevated flex items-center justify-center text-vault-secondary shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <h2 id="pair-request-title" className="text-sm font-semibold text-vault-primary">
              Connect a device?
            </h2>
          </div>
          <p className="text-[0.8125rem] text-vault-secondary leading-relaxed">
            <span className="font-semibold text-vault-primary">{request.device_name}</span> wants to sync with
            this vault. Allow it only if it is your own device — it will be able to read and change everything here.
          </p>
          {error && <p className="text-xs text-vault-error">{error}</p>}
        </div>
        <div className="px-5 py-3.5 bg-vault-bg/60 border-t border-vault-border flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => answer(false)}>
            Deny
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={() => answer(true)}>
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
};
