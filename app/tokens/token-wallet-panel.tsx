"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyTokenWalletChanged } from "@/app/_lib/token-wallet-events";
import { sermonGenerationTokenCost } from "@/app/_lib/sermon-token-pricing";

type PaymentMethod = "card" | "kakaopay" | "naverpay";

type WalletResponse = {
  wallet: {
    balance: number;
    lifetimePurchased: number;
    lifetimeSpent: number;
  };
  history: Array<{
    id: string;
    kind: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
  }>;
  pricing: {
    welcomeGrant: number;
    tokensPer1000Krw: number;
    topupPresetsKrw: number[];
    sermonCosts: {
      basic: number;
      advanced: number;
      reasoning: number;
    };
  };
  checkoutConfigured: boolean;
};

type PortOnePaymentRequest = {
  storeId: string;
  channelKey: string;
  paymentId: string;
  orderName: string;
  totalAmount: number;
  currency: "KRW";
  payMethod: "CARD" | "EASY_PAY";
  customer: {
    customerId: string;
    fullName: string;
    email: string;
  };
  easyPay?: {
    easyPayProvider: "KAKAOPAY" | "NAVERPAY";
  };
  redirectUrl: string;
  noticeUrls: string[];
};

type PortOnePaymentResponse = {
  paymentId?: string;
  txId?: string;
  code?: string;
  message?: string;
};

declare global {
  interface Window {
    PortOne?: {
      requestPayment: (
        request: PortOnePaymentRequest,
      ) => Promise<PortOnePaymentResponse | undefined>;
    };
  }
}

let portOneScriptPromise: Promise<NonNullable<Window["PortOne"]>> | null = null;

function loadPortOne(): Promise<NonNullable<Window["PortOne"]>> {
  if (window.PortOne) return Promise.resolve(window.PortOne);
  if (portOneScriptPromise) return portOneScriptPromise;

  const loader = new Promise<NonNullable<Window["PortOne"]>>((resolve, reject) => {
    const prior = document.querySelector<HTMLScriptElement>(
      'script[src="https://cdn.portone.io/v2/browser-sdk.js"]',
    );
    const script = prior ?? document.createElement("script");
    const ready = () => {
      if (window.PortOne) resolve(window.PortOne);
      else reject(new Error("포트원 결제 모듈을 불러오지 못했습니다."));
    };
    script.addEventListener("load", ready, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("포트원 결제 모듈을 불러오지 못했습니다.")),
      { once: true },
    );
    if (!prior) {
      script.src = "https://cdn.portone.io/v2/browser-sdk.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((caught) => {
    portOneScriptPromise = null;
    throw caught;
  });
  portOneScriptPromise = loader;
  return loader;
}

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readJson<T extends object>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: string; code?: string }
    | null;
  if (!response.ok) {
    // Surface the machine-readable failure code for diagnosis; the code alone
    // distinguishes identity failures from account-store failures.
    const code =
      payload && "code" in payload && typeof payload.code === "string"
        ? payload.code
        : undefined;
    console.warn("[tokens] request failed", { status: response.status, code });
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : "요청을 처리하지 못했습니다.",
    );
  }
  return payload as T;
}

async function confirmPayment(
  paymentId: string,
  transactionId?: string,
): Promise<void> {
  const response = await fetch("/api/tokens/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentId, transactionId }),
  });
  await readJson<{ completed: true }>(response);
}

export function TokenWalletPanel({ email }: { email: string }) {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [selectedKrw, setSelectedKrw] = useState(1_000);
  const [customKrw, setCustomKrw] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [loading, setLoading] = useState(true);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshWallet = useCallback(async () => {
    const response = await fetch("/api/tokens", { cache: "no-store" });
    const payload = await readJson<WalletResponse>(response);
    setData(payload);
    notifyTokenWalletChanged(payload.wallet);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("topup") === "return") {
          const paymentId = params.get("paymentId");
          const code = params.get("code");
          const message = params.get("message");
          if (code) {
            if (!cancelled) setNotice(message || "결제가 취소되었습니다.");
          } else if (paymentId) {
            if (!cancelled) {
              setCheckoutPending(true);
              setNotice("결제 승인을 확인하고 있습니다.");
            }
            await confirmPayment(paymentId, params.get("txId") || undefined);
            if (!cancelled) setNotice("결제가 완료되어 토큰을 충전했습니다.");
          }
          window.history.replaceState(null, "", "/tokens");
        }
        if (!cancelled) await refreshWallet();
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "토큰 지갑을 불러오지 못했습니다.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setCheckoutPending(false);
        }
      }
    }
    void initialLoad();
    return () => {
      cancelled = true;
    };
  }, [refreshWallet]);

  const amountKrw = customMode ? Number(customKrw) : selectedKrw;
  const validAmount =
    Number.isSafeInteger(amountKrw) &&
    amountKrw >= 1_000 &&
    amountKrw <= 500_000 &&
    amountKrw % 1_000 === 0;
  const tokenAmount = useMemo(
    () => (validAmount ? (amountKrw / 1_000) * (data?.pricing.tokensPer1000Krw ?? 200) : 0),
    [amountKrw, data?.pricing.tokensPer1000Krw, validAmount],
  );

  async function checkout() {
    if (!validAmount || checkoutPending || !data?.checkoutConfigured) return;
    setCheckoutPending(true);
    setError("");
    setNotice("");
    try {
      const orderResponse = await fetch("/api/tokens/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountKrw, paymentMethod }),
      });
      const { payment } = await readJson<{ payment: PortOnePaymentRequest }>(
        orderResponse,
      );
      const portOne = await loadPortOne();
      const result = await portOne.requestPayment(payment);
      if (!result) throw new Error("결제 결과를 받지 못했습니다.");
      if (result.code) {
        setNotice(result.message || "결제가 취소되었습니다.");
        return;
      }
      await confirmPayment(
        result.paymentId || payment.paymentId,
        result.txId,
      );
      await refreshWallet();
      setNotice("결제가 완료되어 토큰을 충전했습니다.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "결제를 시작하지 못했습니다.",
      );
    } finally {
      setCheckoutPending(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-8 rounded-[1.75rem] border border-[#ddd7cd] bg-white p-8 text-sm text-[#647168]">
        토큰 지갑을 불러오는 중입니다…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-8 rounded-[1.75rem] border border-[#e1c9bf] bg-[#fff8f4] p-8 text-sm font-semibold text-[#934d36]">
        {error || "토큰 지갑을 불러오지 못했습니다."}
      </div>
    );
  }

  const paymentMethods: Array<{
    id: PaymentMethod;
    label: string;
    description: string;
    activeClass: string;
  }> = [
    {
      id: "card",
      label: "신용·체크카드",
      description: "NHN KCP 카드 결제",
      activeClass: "border-[#182d25] bg-[#182d25] text-white",
    },
    {
      id: "kakaopay",
      label: "카카오페이",
      description: "카카오톡 간편결제",
      activeClass: "border-[#fee500] bg-[#fee500] text-[#191919]",
    },
    {
      id: "naverpay",
      label: "네이버페이",
      description: "네이버 간편결제",
      activeClass: "border-[#03c75a] bg-[#03c75a] text-white",
    },
  ];

  return (
    <div className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,.75fr)]">
      <section
        className="overflow-hidden rounded-[1.75rem] border border-[#d8d4cc] bg-white shadow-[0_18px_55px_rgba(40,48,43,.07)]"
        aria-labelledby="topup-title"
      >
        <div className="border-b border-[#ece8e1] bg-[#fbfaf7] px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[.18em] text-[#a96835]">
                One-time payment
              </p>
              <h2
                id="topup-title"
                className="mt-2 font-serif text-3xl font-bold tracking-[-.03em] text-[#203a30]"
              >
                필요한 만큼만 충전
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#66736c]">
                구독이나 자동 결제 없이 한 번만 결제됩니다.
              </p>
            </div>
            <span className="rounded-full bg-[#edf4ef] px-4 py-2 text-xs font-extrabold text-[#315746]">
              KRW · 1,000원 = 200토큰
            </span>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          {error ? (
            <p role="alert" className="mb-5 rounded-xl bg-[#fff0ea] px-4 py-3 text-sm font-semibold text-[#994c32]">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mb-5 rounded-xl bg-[#edf7f0] px-4 py-3 text-sm font-semibold text-[#2f6948]">
              {notice}
            </p>
          ) : null}

          <fieldset>
            <legend className="text-sm font-extrabold text-[#34483f]">충전 금액</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.pricing.topupPresetsKrw.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setCustomMode(false);
                    setSelectedKrw(amount);
                  }}
                  aria-pressed={!customMode && selectedKrw === amount}
                  className={`min-h-12 rounded-xl px-3 text-sm font-extrabold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] ${
                    !customMode && selectedKrw === amount
                      ? "bg-[#182d25] text-white"
                      : "bg-[#f1f2f0] text-[#263a32] hover:bg-[#e6eae7]"
                  }`}
                >
                  {formatNumber(amount)}원
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomMode(true)}
                aria-pressed={customMode}
                className={`min-h-12 rounded-xl px-3 text-sm font-extrabold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] ${
                  customMode
                    ? "bg-[#182d25] text-white"
                    : "bg-[#f1f2f0] text-[#263a32] hover:bg-[#e6eae7]"
                }`}
              >
                직접 입력
              </button>
            </div>
          </fieldset>

          {customMode ? (
            <label className="mt-5 block max-w-sm text-sm font-extrabold text-[#34483f]">
              직접 입력 · 1,000원–500,000원
              <span className="mt-2 flex min-h-12 items-center rounded-xl border border-[#cfcac1] bg-white px-4 focus-within:ring-2 focus-within:ring-[#b97838]">
                <input
                  type="number"
                  min="1000"
                  max="500000"
                  step="1000"
                  inputMode="numeric"
                  value={customKrw}
                  onChange={(event) => setCustomKrw(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-lg font-bold text-[#203a30] outline-none"
                  aria-describedby="custom-amount-help"
                />
                <span className="ml-2 text-sm text-[#66736c]">원</span>
              </span>
              <span id="custom-amount-help" className="mt-1 block text-xs font-medium text-[#78827c]">
                1,000원 단위로 입력해 주세요.
              </span>
            </label>
          ) : null}

          <fieldset className="mt-7">
            <legend className="text-sm font-extrabold text-[#34483f]">결제수단</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {paymentMethods.map((method) => {
                const active = paymentMethod === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setPaymentMethod(method.id)}
                    aria-pressed={active}
                    className={`min-h-20 rounded-2xl border-2 px-4 py-3 text-left transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] ${
                      active
                        ? method.activeClass
                        : "border-[#e1ded7] bg-white text-[#263a32]"
                    }`}
                  >
                    <span className="block text-sm font-black">{method.label}</span>
                    <span className={`mt-1 block text-xs ${active ? "opacity-80" : "text-[#748078]"}`}>
                      {method.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-8 grid gap-4 rounded-2xl bg-[#f5f3ee] p-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold text-[#728078]">결제 금액</p>
              <p className="mt-1 text-3xl font-black tracking-[-.04em] text-[#172b24]">
                {formatNumber(validAmount ? amountKrw : 0)}원
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-[#728078]">충전 토큰</p>
              <p className="mt-1 text-3xl font-black tracking-[-.04em] text-[#b96331]">
                +{formatNumber(tokenAmount)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#7b837f]">
            포트원과 NHN KCP의 안전한 결제창을 사용합니다. 카드 번호와 간편결제 인증정보는 로고스AI가 저장하지 않습니다.
          </p>

          <button
            type="button"
            onClick={() => void checkout()}
            disabled={!validAmount || checkoutPending || !data.checkoutConfigured}
            className="mt-7 flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#101714] px-6 text-base font-extrabold text-white shadow-[0_12px_25px_rgba(16,23,20,.18)] transition-all hover:-translate-y-0.5 hover:bg-[#1d2d26] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7a363] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
          >
            {checkoutPending
              ? "결제 승인을 확인하는 중…"
              : data.checkoutConfigured
                ? `${paymentMethods.find((method) => method.id === paymentMethod)?.label}로 결제`
                : "결제 연결 준비 중"}
          </button>
          {!data.checkoutConfigured ? (
            <p className="mt-3 text-center text-xs font-semibold text-[#8a5e37]">
              포트원 상점·KCP 채널과 웹훅 설정이 완료되면 결제를 시작할 수 있습니다.
            </p>
          ) : null}
          <p className="mt-7 text-center text-xs text-[#78827c]">
            충전 대상 계정 · <strong className="font-bold text-[#42554c]">{email}</strong>
          </p>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-[1.75rem] bg-[#173129] p-6 text-white shadow-[0_18px_45px_rgba(23,49,41,.18)]" aria-labelledby="balance-title">
          <p className="text-[11px] font-extrabold uppercase tracking-[.18em] text-[#e5c79e]">Available balance</p>
          <h2 id="balance-title" className="mt-3 text-sm font-bold text-white">사용 가능 토큰</h2>
          <p className="mt-1 text-5xl font-black tracking-[-.05em] text-white">{formatNumber(data.wallet.balance)}</p>
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/15 pt-5 text-xs">
            <div><span className="block text-white/75">누적 충전</span><strong className="mt-1 block text-sm text-white">{formatNumber(data.wallet.lifetimePurchased)}</strong></div>
            <div><span className="block text-white/75">누적 사용</span><strong className="mt-1 block text-sm text-white">{formatNumber(data.wallet.lifetimeSpent)}</strong></div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-[#ddd7cd] bg-white p-5" aria-labelledby="pricing-title">
          <h2 id="pricing-title" className="font-serif text-xl font-bold text-[#294238]">설교 생성 차감</h2>
          <p className="mt-2 text-xs leading-5 text-[#737e78]">설교 생성 1회 기준입니다. 비용은 엔진, 설교 분량과 대지 수에 따라 달라지며 초안 개수는 비용에 영향을 주지 않습니다. AI가 첫 결과를 만들지 못한 요청은 자동 환불되고, 저장된 작업을 이어 만들 때는 중복 차감하지 않습니다.</p>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-center justify-between"><dt className="font-bold text-[#43564d]">기본엔진</dt><dd className="font-black text-[#263d34]">{data.pricing.sermonCosts.basic}토큰부터</dd></div>
            <div className="flex items-center justify-between"><dt className="font-bold text-[#43564d]">고급엔진</dt><dd className="font-black text-[#a95d2d]">{data.pricing.sermonCosts.advanced}토큰부터</dd></div>
            <div className="flex items-center justify-between"><dt className="font-bold text-[#43564d]">고급추론엔진</dt><dd className="font-black text-[#7b4f86]">{data.pricing.sermonCosts.reasoning}토큰부터</dd></div>
          </dl>
          <div className="mt-5 rounded-xl bg-[#f5f1e9] p-3 text-xs leading-5 text-[#6d655a]">
            <strong>10분·1포인트</strong>는 기본/고급/고급추론 순으로 15 · 30 · 60토큰,
            {" "}<strong>30분·4대지</strong>는 {sermonGenerationTokenCost("basic", 30, 4)} · {sermonGenerationTokenCost("advanced", 30, 4)} · {sermonGenerationTokenCost("reasoning", 30, 4)}토큰입니다.
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-[#ddd7cd] bg-white p-5" aria-labelledby="history-title">
          <h2 id="history-title" className="font-serif text-xl font-bold text-[#294238]">최근 사용 내역</h2>
          {data.history.length ? (
            <ol className="mt-4 divide-y divide-[#ece8e0]">
              {data.history.slice(0, 10).map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0"><p className="truncate text-xs font-bold text-[#42554c]">{item.description}</p><p className="mt-1 text-[10px] text-[#89918d]">{formatDate(item.createdAt)}</p></div>
                  <span className={`shrink-0 text-sm font-black ${item.amount > 0 ? "text-[#2e7a50]" : "text-[#a4522c]"}`}>{item.amount > 0 ? "+" : ""}{formatNumber(item.amount)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-4 text-xs text-[#7b8580]">아직 사용 내역이 없습니다.</p>}
        </section>
      </aside>
    </div>
  );
}
