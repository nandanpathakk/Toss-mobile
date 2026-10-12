import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';

import { CreateMarketScreen } from './create-market-screen';
import { CreatorPhotoUpload } from './creator-photo-upload';
import { CreatorPublication } from './creator-publication';
import { DetailIconButton } from './detail-ui';
import { hasDraftContent, type LocalMarketDraft } from './draft-library';
import { draftLibrary } from './draft-library-storage';
import { emptyMarketDraft, marketDraftStore } from './market-draft';
import { PantaButton, PantaIcon, PantaText } from './panta-ui';

export function MarketCreatorScreen({
  onClose,
  onBackHandlerChange,
  library = draftLibrary,
  onOpenAccount,
}: {
  onClose: () => void;
  library?: typeof draftLibrary;
  onOpenAccount?: () => void;
  onBackHandlerChange?: (handler: (() => void) | null) => void;
}) {
  const t = useTheme();
  const state = library.useStore();
  const [editing, setEditing] = useState<{ id: string | null } | null>(() =>
    hasDraftContent(marketDraftStore.getState().draft) ? { id: null } : null
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const saving = useRef(false);
  const [publishingBusy, setPublishingBusy] = useState(false);
  const { draft: currentDraft } = marketDraftStore();
  useEffect(() => {
    void library.load();
  }, [library]);
  useEffect(() => {
    if (editing) return;
    onBackHandlerChange?.(onClose);
    return () => onBackHandlerChange?.(null);
  }, [editing, onClose, onBackHandlerChange]);
  function open(record?: LocalMarketDraft) {
    if (state.busy || state.status !== 'ready') return;
    marketDraftStore.setState({ draft: { ...(record?.draft ?? emptyMarketDraft) } });
    setEditing({ id: record?.id ?? null });
    library.useStore.setState({ error: null });
  }
  async function save(close: boolean) {
    if (!editing || saving.current || publishingBusy) return;
    saving.current = true;
    Keyboard.dismiss();
    try {
      const draft = marketDraftStore.getState().draft;
      const id = await library.save(draft, editing.id);
      if (id || (!editing.id && !hasDraftContent(draft))) {
        marketDraftStore.setState({ draft: { ...emptyMarketDraft } });
        setEditing(null);
        if (close) onClose();
      }
    } finally {
      saving.current = false;
    }
  }
  if (editing)
    return (
      <View pointerEvents={state.busy || publishingBusy ? 'none' : 'auto'} style={[a.flex_1]}>
        {state.error && (
          <PantaText accessibilityRole="alert" style={[a.p_16, a.text_13, a.leading_150, { color: panta.no }]}>
            {state.error}
          </PantaText>
        )}
        {state.status === 'idle' && (
          <PantaButton label="Retry loading local drafts" variant="secondary" onPress={() => void library.load()} />
        )}
        <CreateMarketScreen
          key={editing.id ?? 'new'}
          onClose={() => void save(true)}
          onSaveDraft={() => void save(false)}
          onBackToDrafts={() => void save(false)}
          saving={state.busy || publishingBusy}
          imageUpload={
            <CreatorPhotoUpload onChange={imageUrl => marketDraftStore.setState(state => ({ draft: { ...state.draft, imageUrl } }))} />
          }
          publication={
            <CreatorPublication
              draft={currentDraft}
              onBusyChange={setPublishingBusy}
              onOpenAccount={
                onOpenAccount
                  ? () => {
                      void save(false).then(() => {
                        if (!hasDraftContent(marketDraftStore.getState().draft)) onOpenAccount();
                      });
                    }
                  : undefined
              }
            />
          }
          onBackHandlerChange={onBackHandlerChange}
        />
      </View>
    );
  return (
    <View style={[a.flex_1, t.atoms.bg]}>
      <View style={[a.flex_row, a.align_center, a.justify_between, a.px_20, a.py_12]}>
        <PantaText style={[a.text_13, t.atoms.text_secondary]}>Creator studio</PantaText>
        <DetailIconButton icon="close" label="Close my markets" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={[a.p_20, a.gap_24, a.pb_32]}>
        <View style={[a.gap_12]}>
          <PantaText accessibilityRole="header" style={[a.text_30, a.font_bold]}>
            My markets
          </PantaText>
          <PantaText style={[a.text_15, a.leading_150, t.atoms.text_secondary]}>
            A place for your next ideas. Drafts stay on this device, ready when you are.
          </PantaText>
        </View>
        <PantaButton
          label="New market draft"
          disabled={state.status !== 'ready' || state.busy || state.records.length >= 20}
          onPress={() => open()}
        />
        {state.status === 'loading' && <ActivityIndicator color={panta.accent} accessibilityLabel="Loading local drafts" />}
        {state.error && (
          <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
            {state.error}
          </PantaText>
        )}
        {state.status === 'idle' && <PantaButton label="Retry loading drafts" variant="secondary" onPress={() => void library.load()} />}
        <View style={[a.flex_row, a.align_center, a.justify_between]}>
          <PantaText accessibilityRole="header" style={[a.text_20, a.font_semibold]}>
            Local drafts
          </PantaText>
          <PantaText style={[a.text_13, t.atoms.text_secondary]}>{state.records.length} / 20</PantaText>
        </View>
        {state.status === 'ready' && state.records.length === 0 && (
          <View style={[a.py_24, a.gap_12]}>
            <PantaIcon name="rules" color={panta.secondary} size={28} />
            <PantaText style={[a.text_20, a.font_semibold]}>Every market starts with a question</PantaText>
            <PantaText style={[a.text_15, a.leading_150, t.atoms.text_secondary]}>
              Start a draft for any event. You can save it unfinished and return later.
            </PantaText>
          </View>
        )}
        {state.records.map(record => (
          <View key={record.id} style={[a.gap_12, a.p_20, a.rounded_16, t.atoms.bg_elevated]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Resume draft: ${record.draft.question || 'Untitled market'}`}
              disabled={state.busy}
              onPress={() => open(record)}
              style={[a.gap_12, { minHeight: 48 }]}
            >
              <PantaText style={[a.text_11, { color: panta.accent }]}>DRAFT · {record.draft.category.toUpperCase()}</PantaText>
              <PantaText style={[a.text_20, a.font_semibold, a.leading_135]}>{record.draft.question || 'Untitled market'}</PantaText>
              <PantaText style={[a.text_11, t.atoms.text_secondary]}>
                Edited {new Date(record.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </PantaText>
              <PantaText style={[a.text_13, { color: panta.accent }]}>Continue editing →</PantaText>
            </Pressable>
            {deleting === record.id ? (
              <View style={[a.gap_12]}>
                <PantaText style={[a.text_13, a.leading_150]}>Delete this local draft? This cannot be undone.</PantaText>
                <PantaButton
                  label="Delete draft"
                  variant="destructive"
                  disabled={state.busy}
                  onPress={() => {
                    void library.remove(record.id).then(() => setDeleting(null));
                  }}
                />
                <PantaButton label="Keep draft" variant="utility" disabled={state.busy} onPress={() => setDeleting(null)} />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete draft: ${record.draft.question || 'Untitled market'}`}
                disabled={state.busy}
                onPress={() => setDeleting(record.id)}
                style={[a.self_end, a.justify_center, a.px_8, { minHeight: 44 }]}
              >
                <PantaText style={[a.text_13, { color: panta.no }]}>Delete draft</PantaText>
              </Pressable>
            )}
          </View>
        ))}
        <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
          Saved on this device, including after restarting the app. Drafts are not synced to your account. Review creation costs before
          publishing.
        </PantaText>
      </ScrollView>
    </View>
  );
}
