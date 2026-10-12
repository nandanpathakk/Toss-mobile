import React, { useEffect, useRef, useState } from 'react';
import { Image, NativeModules, View } from 'react-native';

import { useIdentityToken, usePrivy } from '@privy-io/expo';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { pantaGatewayUrl } from '@/lib/panta-api';
import { CreationError } from '@/lib/panta-creation';
import { createCreationClient, type CoverFile } from '@/lib/panta-creation-client';

import { PantaButton, PantaText } from './panta-ui';
import { usePantaAccount } from './use-panta-account';

const client = pantaGatewayUrl ? createCreationClient(pantaGatewayUrl) : null;
const picker = NativeModules.TossImagePicker as { pick: () => Promise<CoverFile | null>; remove: (uri: string) => void } | undefined;
export function CreatorPhotoUpload({ onChange }: { onChange: (url: string) => void }) {
  const t = useTheme();
  const account = usePantaAccount();
  const auth = usePrivy();
  const { getIdentityToken } = useIdentityToken();
  const [file, setFile] = useState<CoverFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const flight = useRef(false);
  const selected = useRef<CoverFile | null>(null);
  useEffect(() => {
    current.current++;
    controller.current?.abort();
    setBusy(false);
    setError(null);
    setFile(null);
    if (selected.current) picker?.remove(selected.current.uri);
    selected.current = null;
    return () => {
      current.current++;
      controller.current?.abort();
      if (selected.current) picker?.remove(selected.current.uri);
      selected.current = null;
    };
  }, [account.address, auth.user?.id]);
  async function choose() {
    if (flight.current) return;
    flight.current = true;
    const generation = current.current;
    try {
      const chosen = await picker?.pick();
      if (generation !== current.current) {
        if (chosen) picker?.remove(chosen.uri);
        return;
      }
      if (chosen) {
        if (selected.current) picker?.remove(selected.current.uri);
        selected.current = chosen;
        setFile(chosen);
        setError(null);
      }
    } catch {
      if (generation === current.current) setError('The photo could not be opened. Choose another image or use a link.');
    } finally {
      flight.current = false;
    }
  }
  async function upload() {
    if (!file || !client || !account.address || !auth.user?.id || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    const generation = current.current;
    const userId = auth.user.id;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const refreshed = await auth.refreshUser();
      const access = await auth.getAccessToken(),
        identity = await getIdentityToken();
      if (generation !== current.current || refreshed.user.id !== userId || !access || !identity) return;
      const ticket = await client.ticket(account.address, access, identity, signal);
      if (generation !== current.current) return;
      const url = await client.upload(ticket, file, signal);
      if (generation !== current.current) return;
      onChange(url);
      picker?.remove(file.uri);
      selected.current = null;
      setFile(null);
    } catch (error) {
      if (generation === current.current)
        setError(
          error instanceof CreationError ? error.message : 'The image could not be uploaded. Sign in again or use a public image link.'
        );
    } finally {
      flight.current = false;
      if (generation === current.current) setBusy(false);
    }
  }
  return (
    <View style={[a.gap_12]}>
      {file && (
        <Image
          source={{ uri: file.uri }}
          resizeMode="contain"
          accessibilityLabel="Selected cover, not uploaded yet"
          style={{ width: '100%', height: 156 }}
        />
      )}
      <PantaButton
        label={file ? 'Choose another photo' : 'Choose photo'}
        variant="secondary"
        disabled={busy || !picker}
        onPress={() => void choose()}
      />
      {file && (
        <>
          <PantaText style={[a.text_13, a.leading_150, t.atoms.text_secondary]}>
            Upload this selected image to Panta’s Cloudinary storage. It becomes a public cover link; this does not publish a market.
          </PantaText>
          <PantaButton
            label={busy ? 'Uploading cover…' : 'Upload selected photo'}
            disabled={busy || !account.address || !client}
            onPress={() => void upload()}
          />
          <PantaButton
            label="Remove selected photo"
            variant="utility"
            disabled={busy}
            onPress={() => {
              picker?.remove(file.uri);
              selected.current = null;
              setFile(null);
            }}
          />
        </>
      )}
      {!account.address && (
        <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
          Sign in and set up an account wallet to upload. You can still draft with a public image link.
        </PantaText>
      )}
      {error && (
        <PantaText accessibilityRole="alert" style={[a.text_13, a.leading_150]}>
          {error}
        </PantaText>
      )}
    </View>
  );
}
