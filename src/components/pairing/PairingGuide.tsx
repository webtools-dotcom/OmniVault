import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";

/**
 * Pairing steps, followed by the common reasons nothing shows up. None of them
 * can be detected by the app, so they are spelled out.
 */
export interface PairingGuideProps {
  /**
   * Whether this device issues its own PIN. Only the native apps do; a browser
   * pairs by typing the PIN shown on the desktop.
   */
  showsOwnPin: boolean;
}

export const PairingGuide: React.FC<PairingGuideProps> = ({ showsOwnPin }) => {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="rounded-2xl bg-vault-card px-4 py-3.5">
      <ol className="flex flex-col gap-2.5">
        <li className="flex gap-3 text-xs leading-relaxed text-vault-secondary">
          <span className="w-4 shrink-0 text-vault-subtle">1</span>
          <span>
            Put both devices on the <span className="text-vault-primary">same Wi-Fi</span>, or on
            one phone's hotspot.
          </span>
        </li>
        <li className="flex gap-3 text-xs leading-relaxed text-vault-secondary">
          <span className="w-4 shrink-0 text-vault-subtle">2</span>
          <span>
            Open OmniVault on <span className="text-vault-primary">both</span> of them. They find
            each other on their own, and the other device appears below.
          </span>
        </li>
        <li className="flex gap-3 text-xs leading-relaxed text-vault-secondary">
          <span className="w-4 shrink-0 text-vault-subtle">3</span>
          <span>
            {showsOwnPin ? (
              <>
                Tap <span className="text-vault-primary">Connect</span> next to it, then press{" "}
                <span className="text-vault-primary">Allow</span> on the other device. Only someone
                holding that device can let yours in.
              </>
            ) : (
              <>
                Read the six-digit PIN off the{" "}
                <span className="text-vault-primary">computer's</span> screen and type it here. Only
                the app on the computer issues one — it is never sent over the network, which is
                what makes typing it proof you are standing in front of that machine.
              </>
            )}
          </span>
        </li>
      </ol>

      <button
        type="button"
        onClick={() => setShowHelp((v) => !v)}
        aria-expanded={showHelp}
        className="mt-3 flex items-center gap-1.5 text-xs text-vault-muted hover:text-vault-primary transition-colors cursor-pointer"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showHelp && "rotate-180")} />
        Nothing is showing up
      </button>

      {showHelp && (
        <div className="mt-3 flex flex-col gap-3 pt-3">
          <div>
            <div className="text-xs font-medium text-vault-primary">
              The two devices are on different networks
            </div>
            <p className="mt-1 text-xs leading-relaxed text-vault-muted">
              The most common one, and easy to miss: a phone quietly on mobile data while the laptop
              is on Wi-Fi, or two bands of the same router kept separate. Check both, or put them
              both on one phone's hotspot.
            </p>
          </div>
          <div>
            <div className="text-xs font-medium text-vault-primary">
              OmniVault is not open on the other device
            </div>
            <p className="mt-1 text-xs leading-relaxed text-vault-muted">
              There is no server keeping your notes between visits, so both apps have to be open at
              the same time for anything to move. On a phone, that means in the foreground.
            </p>
          </div>
          <div>
            <div className="text-xs font-medium text-vault-primary">
              The router is keeping devices apart
            </div>
            <p className="mt-1 text-xs leading-relaxed text-vault-muted">
              Guest networks and some hotel and office Wi-Fi block devices from seeing each other at
              all, which no app can work around. Use{" "}
              <span className="text-vault-primary">Connect by address</span> below if you know the
              other device's address, or use a phone hotspot instead.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
