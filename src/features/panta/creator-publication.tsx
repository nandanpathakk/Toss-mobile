import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { useIdentityToken, usePrivy } from '@privy-io/expo';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { AccountVerificationError } from '@/lib/panta-account-verification';
import { pantaGatewayUrl } from '@/lib/panta-api';
import { CreationError, parseCreationRequest } from '@/lib/panta-creation';
import { createCreationClient } from '@/lib/panta-creation-client';

import { CreationCostReview } from './creation-cost-review';
import { createCreationFlowStore } from './creation-flow-store';
import { draftSources, draftTimestamp, type MarketDraft } from './market-draft';
import { PantaButton, PantaText } from './panta-ui';
import { PurchaseReceiptPanel } from './purchase-review-panel';
import { TradingAccountPanel } from './trading-account-panel';
import { usePantaAccount } from './use-panta-account';
import { usePrimaryPurchase } from './use-primary-purchase';
import { useTradingAccountVerification } from './use-trading-account-verification';

const client = pantaGatewayUrl ? createCreationClient(pantaGatewayUrl) : null;
export function CreatorPublication({
  draft,
  onOpenAccount,
  onBusyChange,
}: {
  draft: MarketDraft;
  onOpenAccount?: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTheme();
  const account = usePantaAccount();
  const auth = usePrivy();
  const { getIdentityToken } = useIdentityToken();
  const verified = useTradingAccountVerification(account.address);
  const store = useMemo(() => createCreationFlowStore(client), [draft, account.address, auth.user?.id]);
  const state = store.useStore();
  const owner = useRef({ wallet: account.address, userId: auth.user?.id, ready: account.ready });
  owner.current = { wallet: account.address, userId: auth.user?.id, ready: account.ready };
  const build = account.ready && account.authenticated ? state.build : null;
  const purchase = usePrimaryPurchase(build, account.address, verified.status === 'verified', 'creation');
  const [now, setNow] = useState(Date.now());
  const [registered, setRegistered] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const flight = useRef(false);
  useEffect(() => {
    generation.current++;
    setRegistered(null);
    setRegistering(false);
    setError(null);
    return () => {
      generation.current++;
      store.invalidate();
    };
  }, [store]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const busy = state.busy || purchase.busy || registering;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  async function credentials() {
    const user = auth.user?.id;
    const wallet = account.address;
    const valid = () => owner.current.ready && owner.current.wallet === wallet && owner.current.userId === user;
    if (!user || !wallet || !valid()) throw new AccountVerificationError('ACCOUNT_REQUIRED');
    const refreshed = await auth.refreshUser();
    const access = await auth.getAccessToken(),
      identity = await getIdentityToken();
    if (!valid() || refreshed.user.id !== user || !access || !identity) throw new AccountVerificationError('ACCOUNT_UNVERIFIED');
    return { access, identity };
  }
  async function review() {
    setError(null);
    try {
      const request = parseCreationRequest({
        wallet: account.address,
        question: draft.question.trim(),
        description: draft.description.trim(),
        category: draft.category,
        imageUrl: draft.imageUrl.trim(),
        resolutionRule: draft.resolutionRule.trim(),
        sourcesOfTruth: draftSources(draft.sources),
        startTime: draftTimestamp(draft.startTime),
        endTime: draftTimestamp(draft.endTime),
        resolutionTime: draftTimestamp(draft.resolutionTime),
        marketType: 'standard',
      });
      await store.review(request, credentials);
    } catch (error) {
      setError(error instanceof CreationError ? error.message : 'Check the draft and account before reviewing costs.');
    }
  }
  async function register() {
    if (
      flight.current ||
      !client ||
      !purchase.receipt ||
      purchase.receipt.status !== 'confirmed' ||
      !purchase.receipt.orderId.startsWith('cr_')
    )
      return;
    flight.current = true;
    const current = generation.current;
    setRegistering(true);
    setError(null);
    try {
      const tokens = await credentials();
      if (current !== generation.current) return;
      const result = await client.register(purchase.receipt, tokens.access, tokens.identity);
      if (current === generation.current) setRegistered(result.marketId);
    } catch {
      if (current === generation.current)
        setError(
          'The transaction is confirmed, but catalog registration is not complete. Retry registration; do not publish another transaction.'
        );
    } finally {
      flight.current = false;
      if (current === generation.current) setRegistering(false);
    }
  }
  if (!account.address)
    return (
      <View style={[a.gap_12, a.p_20, a.rounded_16, t.atoms.bg_elevated]}>
        <PantaText style={[a.text_17, a.font_semibold]}>Your draft is ready</PantaText>
        <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
          Sign in and set up an account wallet to check creation costs. Nothing will be published automatically.
        </PantaText>
        {onOpenAccount && <PantaButton label="Save draft & open account" onPress={onOpenAccount} />}
      </View>
    );
  return (
    <View style={[a.gap_20]}>
      <TradingAccountPanel
        canVerify={verified.canVerify}
        status={verified.status}
        error={verified.error}
        onVerify={() => void verified.verify()}
      />
      {purchase.receipt ? (
        <>
          <PurchaseReceiptPanel
            receipt={purchase.receipt}
            transactionLabel="Transaction"
            checking={purchase.busy}
            allowCreationDismiss={registered === purchase.receipt.marketId}
            onCheck={() => void purchase.checkStatus()}
            onDismiss={() => void purchase.dismissResolved()}
          />
          {purchase.receipt.orderId.startsWith('cr_') && purchase.receipt.status === 'confirmed' && (
            <View style={[a.gap_12]}>
              <PantaText style={[a.text_17, a.font_semibold]}>
                {registered === purchase.receipt.marketId ? 'Market registered' : 'Finish catalog registration'}
              </PantaText>
              <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                {registered === purchase.receipt.marketId
                  ? 'Panta accepted this market into its catalog. Discovery may take a little longer to update. Your local draft remains available.'
                  : 'The creation transaction is finalized. Register this same transaction with Panta to add the cover and catalog details. This does not sign or send another transaction.'}
              </PantaText>
              {registered !== purchase.receipt.marketId && (
                <PantaButton
                  label={registering ? 'Registering market…' : 'Register confirmed market'}
                  disabled={busy}
                  onPress={() => void register()}
                />
              )}
            </View>
          )}
        </>
      ) : (
        <>
          {state.quote && account.ready && account.authenticated && (
            <CreationCostReview
              quote={state.quote}
              build={build}
              prepared={purchase.prepared}
              now={now}
              busy={busy}
              canPrepare={purchase.canPrepare}
              onPrepare={() => void purchase.prepare()}
              onApprove={accepted => void purchase.approve(accepted)}
            />
          )}
          <PantaButton
            label={state.busy ? 'Checking creation costs…' : state.quote ? 'Check costs again' : 'Check creation costs'}
            disabled={busy || verified.status !== 'verified' || !client}
            variant={state.quote ? 'secondary' : 'primary'}
            onPress={() => void review()}
          />
        </>
      )}
      {(state.error || purchase.error || error) && (
        <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150]}>
          {error ?? state.error ?? purchase.error}
        </PantaText>
      )}
    </View>
  );
}
