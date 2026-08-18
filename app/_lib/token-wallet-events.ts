export const TOKEN_WALLET_CHANGED_EVENT = "sermon-guide:token-wallet-changed";

export type TokenWalletEventDetail = {
  balance: number;
  lifetimeSpent: number;
};

export function notifyTokenWalletChanged(
  wallet?: TokenWalletEventDetail,
): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof CustomEvent !== "function"
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<TokenWalletEventDetail | undefined>(
      TOKEN_WALLET_CHANGED_EVENT,
      { detail: wallet },
    ),
  );
}
