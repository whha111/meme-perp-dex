"use client";

import { isValidProjectId } from "@/lib/wagmi";
import { ConnectButton as RainbowKitConnectButton } from "@rainbow-me/rainbowkit";
import { WalletButton, WalletButtonCustom } from "./WalletButton";
import type { ReactNode } from "react";

/**
 * ConnectButton compatibility layer.
 * Uses RainbowKit when WalletConnect is configured, otherwise falls back to simple wagmi-based button.
 */
export const ConnectButton = Object.assign(
  function ConnectButtonComponent() {
    if (isValidProjectId) {
      return <RainbowKitConnectButton />;
    }
    return <WalletButton />;
  },
  {
    // Use any for children type to avoid RainbowKit type conflicts
    Custom: function CustomConnectButton({ children }: { children: (props: Record<string, unknown>) => ReactNode }) {
      if (isValidProjectId) {
        return <RainbowKitConnectButton.Custom>{children}</RainbowKitConnectButton.Custom>;
      }

      // Wrap children with additional props for compatibility
      return (
        <WalletButtonCustom>
          {(props) => children({
            ...props,
            openChainModal: () => {},
            authenticationStatus: 'authenticated',
          })}
        </WalletButtonCustom>
      );
    },
  }
);

export default ConnectButton;
