import React from "react";
import { HardDrive, Wifi } from "lucide-react";

export interface WelcomeScreenProps {
  onConnectDevice: () => void;
  onDismiss: () => void;
}

/**
 * First-run screen. It states up front that devices sync only while they share
 * a network, so that limitation is never mistaken for a bug.
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onConnectDevice, onDismiss }) => {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-5 bg-vault-bg overflow-y-auto">
      <div className="w-full max-w-lg py-8">
        <div className="flex items-center gap-2.5">
          <img src="/icons/mark.svg" alt="" className="w-7 h-7" />
          <span className="font-display text-lg font-semibold tracking-[-0.01em] text-vault-primary">
            OmniVault
          </span>
        </div>

        <h1 className="mt-6 font-display text-3xl sm:text-[2rem] font-semibold leading-[1.15] tracking-[-0.02em] text-vault-primary">
          A private notebook that syncs across your own devices.
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-vault-secondary">
          Notes, links, screenshots and tickers, kept in folders you control. Nothing leaves your
          network — there is no account, no cloud and no company in the middle.
        </p>

        <div className="mt-8 flex flex-col gap-5">
          <div className="flex gap-3.5">
            <HardDrive className="w-4 h-4 mt-0.5 text-vault-muted shrink-0" />
            <p className="text-[0.8125rem] leading-relaxed text-vault-secondary">
              <span className="text-vault-primary font-medium">
                Your notes live on your devices.
              </span>{" "}
              Each one keeps its own copy in a plain database.{" "}
              <span className="text-vault-primary font-medium">Back up</span> writes the lot out as
              Markdown you can read in any text editor, with or without this app.
            </p>
          </div>

          <div className="flex gap-3.5">
            <Wifi className="w-4 h-4 mt-0.5 text-vault-muted shrink-0" />
            <p className="text-[0.8125rem] leading-relaxed text-vault-secondary">
              <span className="text-vault-primary font-medium">
                Devices sync when they are both awake on the same Wi-Fi.
              </span>{" "}
              There is no server in between to relay through, so a note written on your phone
              reaches your laptop the next time both are open on the same network — not before. That
              is the trade for keeping it all off the internet.
            </p>
          </div>
        </div>

        <div className="mt-9 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onConnectDevice}
            className="h-11 px-5 rounded-xl bg-vault-accent hover:bg-vault-accent-hover text-vault-ink text-sm font-semibold transition-colors cursor-pointer"
          >
            Connect another device
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="h-11 px-5 rounded-xl bg-vault-card hover:bg-vault-card-hover text-vault-secondary hover:text-vault-primary text-sm transition-colors cursor-pointer"
          >
            Just start writing
          </button>
        </div>

        <p className="mt-5 text-xs text-vault-subtle">
          You can connect a device later from the bottom of the sidebar.
        </p>
      </div>
    </div>
  );
};
