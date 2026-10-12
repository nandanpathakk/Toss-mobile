import { cruise } from './internal/cruise';

let failed = false;
for (const platform of ['ios', 'android']) {
  const result = cruise(platform);
  const errors = result.violations;
  console.log(`${platform}: ${errors.length} dependency errors`);
  if (errors.length) {
    console.error(JSON.stringify(errors, null, 2));
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
