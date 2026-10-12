import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';
import { creationCategories } from '@/lib/panta-creation';

import { categoryLabel } from './catalog-card';
import { CreatorDatePicker } from './creator-date-picker';
import { CreatorImageInput, CreatorSourcesInput, CreatorTextEditor } from './creator-inputs';
import { DetailField, DetailHeading, DetailIconButton, DetailSurface } from './detail-ui';
import { draftTimestamp, marketDraftStore, validateMarketDraft, type DraftErrors, type DraftField } from './market-draft';
import { PantaBadge, PantaButton, PantaIcon, PantaText } from './panta-ui';

const steps = ['Question', 'Timeline', 'Resolution', 'Review'] as const;
type DateField = 'startTime' | 'endTime' | 'resolutionTime';
const dates: { key: DateField; label: string; hint: string }[] = [
  { key: 'startTime', label: 'Primary phase ends', hint: 'When primary buying closes and the event begins.' },
  { key: 'endTime', label: 'Event ends', hint: 'The deadline for the outcome to happen.' },
  { key: 'resolutionTime', label: 'Expected resolution', hint: 'When public evidence should be available.' },
];
const stepFields: DraftField[][] = [
  ['question', 'category', 'imageUrl', 'description'],
  ['startTime', 'endTime', 'resolutionTime'],
  ['resolutionRule', 'sources'],
];
function readableDate(value: string) {
  const timestamp = draftTimestamp(value);
  return timestamp === null
    ? 'Choose date and time'
    : new Date(timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function CreateMarketScreen({
  onClose,
  onBackHandlerChange,
  onSaveDraft,
  onBackToDrafts,
  saving = false,
  publication,
  imageUpload,
}: {
  onClose: () => void;
  onSaveDraft?: () => void;
  onBackToDrafts?: () => void;
  saving?: boolean;
  publication?: React.ReactNode;
  imageUpload?: React.ReactNode;
  onBackHandlerChange?: (handler: (() => void) | null) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { draft } = marketDraftStore();
  const [step, setStep] = useState(0);
  const [dateField, setDateField] = useState<DateField | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(Boolean(draft.description));
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const scroll = useRef<ScrollView>(null);
  function update(field: DraftField, value: string) {
    marketDraftStore.setState(state => ({ draft: { ...state.draft, [field]: value } }));
    setErrors(current => ({ ...current, [field]: undefined }));
  }
  function go(next: number) {
    Keyboard.dismiss();
    setStep(next);
    setErrors({});
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  const back = useCallback(() => {
    if (saving) return;
    Keyboard.dismiss();
    if (dateField) setDateField(null);
    else if (step > 0) setStep(step - 1);
    else (onBackToDrafts ?? onClose)();
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [dateField, step, onClose, onBackToDrafts, saving]);
  useEffect(() => {
    onBackHandlerChange?.(back);
    return () => onBackHandlerChange?.(null);
  }, [back, onBackHandlerChange]);
  function next() {
    const all = validateMarketDraft(draft);
    const keys = stepFields[step];
    const relevant = Object.fromEntries(Object.entries(all).filter(([key]) => keys.includes(key as DraftField))) as DraftErrors;
    setErrors(relevant);
    if (Object.values(relevant).some(Boolean)) {
      Keyboard.dismiss();
      scroll.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    if (step === 2) {
      const first = stepFields.findIndex(fields => fields.some(field => all[field]));
      if (first >= 0) {
        setStep(first);
        setErrors(all);
        return;
      }
    }
    go(step + 1);
  }
  return (
    <KeyboardAvoidingView style={[a.flex_1, t.atoms.bg]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[a.flex_row, a.align_center, a.justify_between, a.px_20, a.py_12]}>
        {step > 0 || dateField || onBackToDrafts ? (
          <DetailIconButton
            icon="back"
            label={dateField ? 'Cancel date selection' : step > 0 ? 'Previous creation step' : 'Save and return to drafts'}
            onPress={back}
          />
        ) : (
          <PantaBadge label="Local draft" />
        )}
        <PantaText style={[a.text_13, t.atoms.text_secondary]}>{dateField ? 'Timeline' : `${step + 1} of 4 · ${steps[step]}`}</PantaText>
        <DetailIconButton
          icon="close"
          label="Save draft and close"
          onPress={() => {
            if (!saving) onClose();
          }}
        />
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Market draft progress"
        accessibilityValue={{ min: 1, max: 4, now: step + 1, text: steps[step] }}
        style={[a.flex_row, a.gap_8, a.px_20]}
      >
        {steps.map((name, index) => (
          <View
            key={name}
            style={[a.flex_1, a.rounded_full, { height: 3, backgroundColor: index <= step ? panta.accent : panta.border }]}
          />
        ))}
      </View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[a.p_20, a.gap_24, a.pb_32]}
      >
        {dateField ? (
          <CreatorDatePicker
            key={dateField}
            label={dates.find(date => date.key === dateField)!.label}
            value={draft[dateField]}
            onCancel={() => setDateField(null)}
            onSave={value => {
              update(dateField, value);
              setDateField(null);
              scroll.current?.scrollTo({ y: 0, animated: false });
            }}
          />
        ) : (
          <>
            <View style={[a.gap_12]}>
              <PantaText accessibilityRole="header" style={[a.text_30, a.font_bold]}>
                {['What’s your question?', 'Set the timeline', 'Make the result clear', 'Review your market'][step]}
              </PantaText>
              <PantaText style={[a.text_15, a.leading_150, t.atoms.text_secondary]}>
                {
                  [
                    'Start with one clear, verifiable YES or NO outcome.',
                    'Choose when primary buying ends, the event deadline and expected resolution.',
                    'Give traders the criteria and evidence that decide the outcome.',
                    'Check how your draft will read before any publication steps.',
                  ][step]
                }
              </PantaText>
            </View>
            {Object.values(errors).some(Boolean) && (
              <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
                Check the highlighted information before continuing.
              </PantaText>
            )}
            {step === 0 && (
              <>
                <CreatorTextEditor
                  label="Market question"
                  hint="Include the event, threshold and deadline when relevant."
                  value={draft.question}
                  onChange={value => update('question', value)}
                  maxLength={512}
                  large
                  error={errors.question}
                />
                <PantaText style={[a.text_13, t.atoms.text_secondary]}>Outcomes: YES / NO</PantaText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose market category"
                  accessibilityState={{ expanded: categoriesOpen }}
                  onPress={() => setCategoriesOpen(value => !value)}
                  style={[a.flex_row, a.align_center, a.justify_between, a.py_12, { minHeight: 52 }]}
                >
                  <View style={[a.gap_8]}>
                    <PantaText style={[a.text_13, t.atoms.text_secondary]}>Category</PantaText>
                    <PantaText style={[a.text_17, a.font_semibold]}>{categoryLabel(draft.category)}</PantaText>
                  </View>
                  <PantaIcon name="chevron" />
                </Pressable>
                {categoriesOpen && (
                  <View style={[a.flex_row, a.flex_wrap, a.gap_8]}>
                    {creationCategories.map(category => (
                      <Pressable
                        key={category}
                        accessibilityRole="button"
                        accessibilityLabel={categoryLabel(category)}
                        accessibilityState={{ selected: category === draft.category }}
                        onPress={() => {
                          update('category', category);
                          setCategoriesOpen(false);
                        }}
                        style={[
                          a.p_16,
                          a.rounded_12,
                          {
                            minHeight: 48,
                            minWidth: '45%',
                            flexGrow: 1,
                            backgroundColor: category === draft.category ? panta.accentBackground : panta.surface,
                          },
                        ]}
                      >
                        <PantaText style={[a.text_15, a.font_semibold, { color: category === draft.category ? panta.accent : panta.text }]}>
                          {categoryLabel(category)}
                          {category === draft.category ? ' ✓' : ''}
                        </PantaText>
                      </Pressable>
                    ))}
                  </View>
                )}
                <CreatorImageInput value={draft.imageUrl} onChange={value => update('imageUrl', value)} error={errors.imageUrl} />
                {imageUpload}
                <PantaButton
                  label={descriptionOpen ? 'Hide description' : 'Add description · optional'}
                  variant="utility"
                  onPress={() => setDescriptionOpen(value => !value)}
                />
                {descriptionOpen && (
                  <CreatorTextEditor
                    label="Description"
                    hint="Add useful context without changing the question or resolution rules."
                    value={draft.description}
                    onChange={value => update('description', value)}
                    maxLength={4000}
                    error={errors.description}
                  />
                )}
              </>
            )}
            {step === 1 && (
              <>
                <PantaBadge label="Standard market draft" />
                <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                  All times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. The required opening delay must be checked with Panta
                  before publication.
                </PantaText>
                <View style={[a.rounded_16, a.px_16, t.atoms.bg_elevated]}>
                  {dates.map(({ key, label, hint }, index) => (
                    <View key={key} style={[a.gap_8, index < 2 && a.border_b, t.atoms.border_secondary]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${label}: ${readableDate(draft[key])}`}
                        onPress={() => {
                          Keyboard.dismiss();
                          setDateField(key);
                          scroll.current?.scrollTo({ y: 0, animated: false });
                        }}
                        style={[a.flex_row, a.align_center, a.gap_12, a.py_20]}
                      >
                        <View style={[a.flex_1, a.gap_8]}>
                          <PantaText style={[a.text_13, t.atoms.text_secondary]}>{label}</PantaText>
                          <PantaText style={[a.text_17, a.font_semibold, a.leading_135]}>{readableDate(draft[key])}</PantaText>
                          <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>{hint}</PantaText>
                        </View>
                        <PantaIcon name="chevron" size={18} color={panta.secondary} />
                      </Pressable>
                      {errors[key] && (
                        <PantaText accessibilityRole="alert" style={[a.pb_12, a.text_13, a.leading_150, { color: panta.no }]}>
                          {errors[key]}
                        </PantaText>
                      )}
                    </View>
                  ))}
                </View>
              </>
            )}
            {step === 2 && (
              <>
                <CreatorTextEditor
                  label="Resolution criteria"
                  hint="State what counts as YES, what counts as NO, the cutoff and how ambiguity is handled."
                  value={draft.resolutionRule}
                  onChange={value => update('resolutionRule', value)}
                  maxLength={2048}
                  error={errors.resolutionRule}
                />
                <CreatorSourcesInput value={draft.sources} onChange={value => update('sources', value)} error={errors.sources} />
              </>
            )}
            {step === 3 && (
              <>
                <View style={[a.gap_16]}>
                  <PantaBadge label={`${categoryLabel(draft.category)} · Standard`} />
                  <PantaText style={[a.text_26, a.font_bold, a.leading_135]}>{draft.question.trim()}</PantaText>
                  {!!draft.description && (
                    <PantaText style={[a.text_15, a.leading_150, t.atoms.text_secondary]}>{draft.description.trim()}</PantaText>
                  )}
                  <PantaButton label="Edit question and cover" variant="utility" onPress={() => go(0)} />
                </View>
                <CreatorImageInput value={draft.imageUrl} onChange={value => update('imageUrl', value)} error={errors.imageUrl} />
                <DetailHeading title="Timeline" />
                <DetailSurface>
                  {dates.map(({ key, label }, index) => (
                    <DetailField key={key} label={label} value={readableDate(draft[key])} last={index === 2} />
                  ))}
                </DetailSurface>
                <PantaButton label="Edit timeline" variant="utility" onPress={() => go(1)} />
                <DetailHeading title="Resolution" />
                <PantaText style={[a.text_15, a.leading_150]}>{draft.resolutionRule.trim()}</PantaText>
                <PantaText selectable style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                  {draft.sources.trim()}
                </PantaText>
                <PantaButton label="Edit resolution and sources" variant="utility" onPress={() => go(2)} />
                {publication ?? (
                  <View style={[a.p_20, a.gap_12, a.rounded_16, t.atoms.bg_elevated]}>
                    <PantaText style={[a.text_17, a.font_semibold]}>Ready to save to local drafts</PantaText>
                    <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
                      Publishing is not available yet. Permission, required delay, creation fees and network costs must be verified before
                      you can approve publication. No market or transaction has been created.
                    </PantaText>
                  </View>
                )}
              </>
            )}
            <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
              Save and return anytime. Drafts stay on this device and are never published automatically.
            </PantaText>
          </>
        )}
      </ScrollView>
      {!dateField && (
        <View style={[a.px_20, a.pt_12, a.border_t, t.atoms.border_secondary, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <PantaButton
            label={saving ? 'Saving draft…' : step === 3 ? 'Save draft' : step === 2 ? 'Review draft' : 'Continue'}
            disabled={saving}
            variant={step === 3 && publication ? 'secondary' : 'primary'}
            onPress={step === 3 ? (onSaveDraft ?? onClose) : next}
          />
          {step < 3 && onSaveDraft && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save incomplete draft and return to drafts"
              disabled={saving}
              onPress={onSaveDraft}
              style={[a.align_center, a.justify_center, a.py_12, { minHeight: 44 }]}
            >
              <PantaText style={[a.text_13, t.atoms.text_secondary]}>Save and return to drafts</PantaText>
            </Pressable>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
