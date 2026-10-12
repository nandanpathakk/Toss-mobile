import React, { useEffect, useState } from 'react';
import { Image, Keyboard, Pressable, TextInput, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';

import { DetailHeading, DetailIconButton } from './detail-ui';
import { draftSources, isPublicDraftUrl, saveDraftSource } from './market-draft';
import { PantaButton, pantaFont, PantaIcon, PantaText } from './panta-ui';

export function CreatorTextEditor({
  label,
  hint,
  value,
  onChange,
  maxLength,
  large = false,
  error,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  large?: boolean;
  error?: string;
}) {
  const t = useTheme();
  return (
    <View style={[a.gap_12]}>
      <DetailHeading title={label} subtitle={hint} />
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        multiline
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        placeholder={large ? 'Will…' : 'Write here…'}
        placeholderTextColor={panta.secondary}
        style={[
          pantaFont,
          a.py_16,
          a.border_b,
          large ? a.text_26 : a.text_17,
          { lineHeight: large ? 39 : 26 },
          { minHeight: large ? 144 : 120, color: panta.text, borderColor: error ? panta.no : panta.border, textAlignVertical: 'top' },
        ]}
      />
      <PantaText style={[a.text_11, t.atoms.text_secondary]}>
        {value.length} / {maxLength}
      </PantaText>
      {error && (
        <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
          {error}
        </PantaText>
      )}
    </View>
  );
}
function LinkEditor({
  label,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      keyboardType="url"
      returnKeyType="done"
      onSubmitEditing={onSubmit}
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={2048}
      placeholder="https://"
      placeholderTextColor={panta.secondary}
      style={[pantaFont, a.p_16, a.rounded_12, a.text_15, { minHeight: 52, color: panta.text, backgroundColor: panta.surface }]}
    />
  );
}
export function CreatorImageInput({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [candidate, setCandidate] = useState(value);
  const [failed, setFailed] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => setFailed(false), [value]);
  const valid = isPublicDraftUrl(value);
  return (
    <View style={[a.gap_12]}>
      <DetailHeading title="Cover image" subtitle="Add a public image link. A square image works best." />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={valid ? 'Change cover image link' : 'Add cover image link'}
        onPress={() => {
          setCandidate(value);
          setEditing(true);
        }}
        style={[
          a.rounded_16,
          a.overflow_hidden,
          a.align_center,
          a.justify_center,
          a.gap_12,
          a.p_20,
          { minHeight: 156, backgroundColor: panta.surface },
        ]}
      >
        {valid && !failed ? (
          <Image
            source={{ uri: value }}
            resizeMode="contain"
            onError={() => setFailed(true)}
            accessible={false}
            style={{ height: 156, width: '100%' }}
          />
        ) : (
          <PantaIcon name="share" color={panta.accent} size={28} />
        )}
        <PantaText style={[a.text_15, a.font_semibold]}>
          {failed ? 'Image could not load · change link' : valid ? 'Change image link' : 'Add image link'}
        </PantaText>
      </Pressable>
      {editing && (
        <View style={[a.gap_12]}>
          <LinkEditor label="Public cover image URL" value={candidate} onChange={setCandidate} />
          <PantaButton
            label="Use image link"
            variant="secondary"
            onPress={() => {
              if (!isPublicDraftUrl(candidate.trim())) {
                setLinkError('Use a public https or http image URL.');
                return;
              }
              onChange(candidate.trim());
              setEditing(false);
              setLinkError(null);
            }}
          />
          <PantaButton
            label="Cancel"
            variant="utility"
            onPress={() => {
              setEditing(false);
              setLinkError(null);
            }}
          />
        </View>
      )}
      {(error || linkError) && (
        <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
          {linkError ?? error}
        </PantaText>
      )}
      <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
        Use a public image link, or choose a photo below. Adding a link does not upload or publish an image.
      </PantaText>
    </View>
  );
}
export function CreatorSourcesInput({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const t = useTheme();
  const sources = draftSources(value);
  const [editing, setEditing] = useState<number | null>(null);
  const [candidate, setCandidate] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  function save() {
    const result = saveDraftSource(value, candidate, editing);
    if (result.error) {
      setLinkError(result.error);
      return;
    }
    Keyboard.dismiss();
    onChange(result.value);
    setCandidate('');
    setEditing(null);
    setLinkError(null);
  }
  return (
    <View style={[a.gap_16]}>
      <DetailHeading title="Sources of truth" subtitle="Link to the official result or public evidence that will decide this market." />
      {sources.map((source, index) => (
        <View key={`${source}-${index}`} style={[a.flex_row, a.align_center, a.gap_12, a.py_12, a.border_b, t.atoms.border_secondary]}>
          <PantaText tabular style={[a.text_13, { color: panta.accent }]}>
            {String(index + 1).padStart(2, '0')}
          </PantaText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit source ${index + 1}: ${source}`}
            onPress={() => {
              setEditing(index);
              setCandidate(source);
              setLinkError(null);
            }}
            style={[a.flex_1, a.gap_8, a.justify_center, { minHeight: 48 }]}
          >
            <PantaText style={[a.text_15, a.font_semibold]}>
              {isPublicDraftUrl(source) ? new URL(source).hostname : `Source ${index + 1}`}
            </PantaText>
            <PantaText numberOfLines={2} style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
              {source}
            </PantaText>
            <PantaText style={[a.text_11, { color: panta.accent }]}>Edit link</PantaText>
          </Pressable>
          <DetailIconButton
            icon="close"
            label={`Remove source ${index + 1}`}
            onPress={() => {
              onChange(sources.filter((_, n) => n !== index).join('\n'));
              setEditing(null);
              setCandidate('');
              setLinkError(null);
            }}
          />
        </View>
      ))}
      {(sources.length < 20 || editing !== null) && (
        <View style={[a.gap_12]}>
          <PantaText style={[a.text_13, a.font_semibold]}>{editing === null ? 'Add a source' : `Editing source ${editing + 1}`}</PantaText>
          <LinkEditor
            label={editing === null ? 'New source URL' : 'Edit source URL'}
            onSubmit={save}
            value={candidate}
            onChange={value => {
              setCandidate(value);
              setLinkError(null);
            }}
          />
          <View style={[a.flex_row, a.flex_wrap, a.gap_8]}>
            <PantaButton label={editing === null ? 'Add link' : 'Save changes'} variant="secondary" onPress={save} />
            {editing !== null && (
              <PantaButton
                label="Cancel edit"
                variant="utility"
                onPress={() => {
                  setEditing(null);
                  setCandidate('');
                  setLinkError(null);
                }}
              />
            )}
          </View>
          <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
            Add each link separately. You can include up to 20 sources.
          </PantaText>
        </View>
      )}
      <PantaText style={[a.text_11, t.atoms.text_secondary]}>
        {sources.length} {sources.length === 1 ? 'source added' : 'sources added'}
      </PantaText>
      {(error || linkError) && (
        <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
          {linkError ?? error}
        </PantaText>
      )}
    </View>
  );
}
