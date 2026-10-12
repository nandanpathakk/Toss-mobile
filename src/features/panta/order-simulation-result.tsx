import React from 'react';
import { View } from 'react-native';

import { atoms as a } from '@/design/atoms';
import { useTheme } from '@/design/context';
import { preflightMessages, type PreflightReport } from '@/lib/panta-order-preflight';

import { PantaText } from './panta-ui';

export function OrderSimulationResult({ report }: { report: PreflightReport }) {
  const t = useTheme();
  return (
    <View style={[a.gap_8]}>
      <PantaText accessibilityRole={report.status === 'blocked' ? 'alert' : undefined} style={[a.text_13, a.leading_150]}>
        {report.status === 'simulated' ? 'Simulation completed. No funds moved.' : preflightMessages[report.code!]}
      </PantaText>
      {report.networkFeeLamports !== null && (
        <PantaText style={[a.text_11, t.atoms.text_secondary]}>Estimated network fee: {report.networkFeeLamports} lamports</PantaText>
      )}
      <PantaText style={[a.text_11, a.leading_150, t.atoms.text_secondary]}>
        This check does not approve a purchase. Market prices can change before execution, and the final share count is not guaranteed.
      </PantaText>
    </View>
  );
}
