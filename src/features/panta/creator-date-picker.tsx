import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { panta } from '@/design/tokens';

import { DetailIconButton } from './detail-ui';
import { calendarMonth, draftTimestamp, formatDraftDate } from './market-draft';
import { PantaButton, pantaFont, PantaText } from './panta-ui';

/** Focused calendar/time steps; the calendar bleeds into the inset on narrow screens. */
export function CreatorDatePicker({
  label,
  value,
  onSave,
  onCancel,
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const initial = draftTimestamp(value);
  const [date, setDate] = useState(() => (initial === null ? new Date(Date.now() + 86400000) : new Date(initial * 1000)));
  const [month, setMonth] = useState(() => new Date(date.getFullYear(), date.getMonth(), 1));
  const [tab, setTab] = useState<'date' | 'time'>('date');
  const [hour, setHour] = useState(String(date.getHours()).padStart(2, '0'));
  const [minute, setMinute] = useState(String(date.getMinutes()).padStart(2, '0'));
  const [error, setError] = useState<string | null>(null);
  const cells = calendarMonth(month.getFullYear(), month.getMonth());
  function save() {
    if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23 || !/^\d{1,2}$/.test(minute) || Number(minute) > 59) {
      setTab('time');
      setError('Choose an hour from 00–23 and a minute from 00–59.');
      return;
    }
    const next = new Date(date);
    next.setHours(Number(hour), Number(minute), 0, 0);
    if (next.getHours() !== Number(hour) || next.getMinutes() !== Number(minute)) {
      setError('This time is not available in your timezone. Choose another time.');
      return;
    }
    onSave(formatDraftDate(next));
  }
  return (
    <>
      <View style={[a.gap_12]}>
        <PantaText accessibilityRole="header" style={[a.text_26, a.font_bold]}>
          {label}
        </PantaText>
        <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
          Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </PantaText>
      </View>
      <View style={[a.flex_row, a.p_4, a.rounded_12, t.atoms.bg_elevated]}>
        {(['date', 'time'] as const).map(item => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item }}
            onPress={() => setTab(item)}
            style={[
              a.flex_1,
              a.align_center,
              a.justify_center,
              a.py_12,
              a.rounded_8,
              { minHeight: 48, backgroundColor: tab === item ? panta.border : 'transparent' },
            ]}
          >
            <PantaText style={[a.text_15, a.font_semibold, tab === item ? t.atoms.text : t.atoms.text_secondary]}>
              {item === 'date' ? 'Date' : 'Time'}
            </PantaText>
          </Pressable>
        ))}
      </View>
      {tab === 'date' ? (
        <View style={[a.gap_12]}>
          <View style={[a.flex_row, a.align_center, a.justify_between]}>
            <DetailIconButton
              icon="back"
              label="Previous month"
              onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            />
            <PantaText style={[a.flex_1, a.text_center, a.text_17, a.font_semibold]}>
              {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </PantaText>
            <DetailIconButton
              icon="chevron"
              label="Next month"
              onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            />
          </View>
          <View style={[a.mx_neg_16]}>
            <View style={[a.flex_row]}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                <View key={i} style={[a.flex_1, a.align_center, a.py_8]}>
                  <PantaText style={[a.text_11, t.atoms.text_secondary]}>{day}</PantaText>
                </View>
              ))}
            </View>
            {Array.from({ length: cells.length / 7 }, (_, week) => (
              <View key={week} style={[a.flex_row]}>
                {cells.slice(week * 7, week * 7 + 7).map((day, i) => {
                  const selected =
                    day === date.getDate() && month.getMonth() === date.getMonth() && month.getFullYear() === date.getFullYear();
                  return (
                    <View key={i} style={[a.flex_1]}>
                      {day !== null && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={new Date(month.getFullYear(), month.getMonth(), day).toLocaleDateString(undefined, {
                            dateStyle: 'full',
                          })}
                          accessibilityState={{ selected }}
                          onPress={() => {
                            const next = new Date(date);
                            next.setFullYear(month.getFullYear(), month.getMonth(), day);
                            setDate(next);
                            setError(null);
                          }}
                          style={[a.align_center, a.justify_center, { minHeight: 48 }]}
                        >
                          <View
                            style={[
                              a.align_center,
                              a.justify_center,
                              a.rounded_full,
                              { minWidth: 40, minHeight: 40, backgroundColor: selected ? panta.accent : 'transparent' },
                            ]}
                          >
                            <PantaText tabular style={[a.text_17, a.font_semibold, { color: selected ? panta.background : panta.text }]}>
                              {day}
                            </PantaText>
                          </View>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
          <PantaButton label="Choose time" variant="secondary" onPress={() => setTab('time')} />
        </View>
      ) : (
        <View style={[a.gap_24]}>
          <View style={[a.gap_12]}>
            <PantaText style={[a.text_13, t.atoms.text_secondary]}>24-hour time · tap a number to edit</PantaText>
            <View style={[a.flex_row, a.align_center, a.justify_center, a.gap_12]}>
              {(['hour', 'minute'] as const).map((part, i) => (
                <React.Fragment key={part}>
                  {i === 1 && <PantaText style={[a.text_30, t.atoms.text_secondary]}>:</PantaText>}
                  <View style={[a.flex_1, a.gap_8]}>
                    <TextInput
                      accessibilityLabel={part === 'hour' ? 'Hour, 00 to 23' : 'Minute, 00 to 59'}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      maxLength={2}
                      value={part === 'hour' ? hour : minute}
                      onChangeText={text => {
                        (part === 'hour' ? setHour : setMinute)(text.replace(/\D/g, ''));
                        setError(null);
                      }}
                      style={[
                        pantaFont,
                        a.py_20,
                        a.rounded_16,
                        {
                          fontSize: 40,
                          lineHeight: 48,
                          textAlign: 'center',
                          color: panta.text,
                          backgroundColor: panta.surface,
                          minHeight: 88,
                        },
                      ]}
                    />
                    <PantaText style={[a.text_11, a.text_center, t.atoms.text_secondary]}>{part === 'hour' ? 'Hour' : 'Minute'}</PantaText>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </View>
          <View style={[a.gap_12]}>
            <PantaText style={[a.text_13, t.atoms.text_secondary]}>Quick minutes</PantaText>
            <View style={[a.flex_row, a.flex_wrap, a.gap_8]}>
              {['00', '15', '30', '45'].map(item => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityLabel={`${item} minutes`}
                  accessibilityState={{ selected: minute === item }}
                  onPress={() => {
                    setMinute(item);
                    setError(null);
                  }}
                  style={[
                    a.flex_1,
                    a.align_center,
                    a.justify_center,
                    a.rounded_12,
                    { minHeight: 48, backgroundColor: minute === item ? panta.accentBackground : panta.surface },
                  ]}
                >
                  <PantaText tabular style={[a.text_15, { color: minute === item ? panta.accent : panta.text }]}>
                    {item}
                  </PantaText>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      )}
      <View style={[a.gap_8, a.py_12, a.border_t, t.atoms.border_secondary]}>
        <PantaText style={[a.text_17, a.font_semibold, a.leading_135]}>
          {date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </PantaText>
        <PantaText tabular style={[a.text_15, t.atoms.text_secondary]}>
          {hour.padStart(2, '0')}:{minute.padStart(2, '0')}
        </PantaText>
      </View>
      {error && (
        <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150, { color: panta.no }]}>
          {error}
        </PantaText>
      )}
      <PantaButton label="Use this date and time" onPress={save} />
      <PantaButton label="Cancel" variant="utility" onPress={onCancel} />
    </>
  );
}
