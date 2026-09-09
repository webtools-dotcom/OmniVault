import React, { useState, useRef, useEffect } from "react";
import { Check, Laptop, ShieldCheck, X } from "lucide-react";
import { StorageService } from "../../services/storageService";

export interface PeerPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaired?: () => void;
}

export const PeerPinModal: React.FC<PeerPinModalProps> = ({ isOpen, onClose, onPaired }) => {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [deviceName, setDeviceName] = useState<string>(() => {
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent;
      if (/iPad|Tablet/i.test(ua)) return "Tablet Peer";
      if (/iPhone|Android/i.test(ua)) return "Mobile Peer";
      return "Web Peer";
    }
    return "Tablet Peer";
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first input on open
  useEffect(() => {
    if (isOpen) {
      setDigits(["", "", "", "", "", ""]);
      setErrorMsg(null);
      setSuccess(false);
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleDigitChange = (index: number, val: string) => {
    // Handle pasting a 6-digit PIN like "749 201" or "749201"
    const cleaned = val.replace(/\D/g, "");
    if (cleaned.length > 1) {
      const newDigits = [...digits];
      for (let i = 0; i < 6; i++) {
        newDigits[i] = cleaned[i] || "";
      }
      setDigits(newDigits);
      const nextIndex = Math.min(cleaned.length, 5);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    const digit = cleaned.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    // Auto-advance
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      inputRefs.current[index + 1]?.focus();
    } else if (e.key === "Enter") {
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    const pin = digits.join("");
    if (pin.length < 4) {
      setErrorMsg("Please enter the 6-digit PIN displayed on your desktop screen.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const res = await StorageService.pairDevice(pin, deviceName);
    setIsSubmitting(false);

    if (res.success) {
      setSuccess(true);
      setTimeout(() => {
        onPaired?.();
        onClose();
      }, 800);
    } else {
      setErrorMsg(res.error || "Authentication failed. Check the PIN and try again.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none animate-in fade-in duration-150">
      <div
        className="w-full max-w-sm bg-[#141418] border border-white/[0.1] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] overflow-hidden animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="peer-pin-title"
      >
        {/* Terminal Header */}
        <div className="h-9 px-3.5 border-b border-white/[0.08] bg-[#18181D] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]" />
            <span className="font-mono text-xs text-zinc-300">vault://pair/authenticate</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="peer-pin-title" className="text-sm font-semibold text-zinc-100">
                Link to Desktop Vault
              </h2>
              <p className="text-[11px] text-zinc-400 font-mono">
                Enter authorization PIN from desktop
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400 block">
              6-DIGIT AUTHORIZATION PIN
            </label>
            <div className="flex items-center justify-between gap-1.5 sm:gap-2">
              {digits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (inputRefs.current[idx] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={digit}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  disabled={isSubmitting || success}
                  className="w-10 h-12 text-center text-lg font-mono font-bold bg-[#1B1B22] border border-white/[0.1] rounded-xl text-zinc-100 focus:outline-hidden focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all disabled:opacity-50"
                  aria-label={`Digit ${idx + 1}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-500 uppercase block">
              Device Name
            </label>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#18181D] border border-white/[0.08] rounded-lg">
              <Laptop className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="e.g. iPad Pro"
                className="w-full text-xs font-mono text-zinc-200 bg-transparent outline-hidden"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
              {errorMsg}
            </div>
          )}

          {success && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>Device linked successfully!</span>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 text-xs font-mono text-zinc-400 hover:text-zinc-200 bg-transparent hover:bg-white/[0.05] rounded-lg transition-colors cursor-pointer"
            >
              Browse Local
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || success}
              className="h-8 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isSubmitting ? "Linking..." : success ? "Linked" : "Authorize PIN"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
