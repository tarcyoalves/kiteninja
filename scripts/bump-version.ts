/**
 * Script de versionamento único para PWA (package.json) e Android.
 *
 *用法:
 *   npx tsx scripts/bump-version.ts           # mostra versão atual
 *   npx tsx scripts/bump-version.ts minor    # bump minor (0.1.0 → 0.2.0)
 *   npx tsx scripts/bump-version.ts patch     # bump patch (0.1.0 → 0.1.1)
 *   npx tsx scripts/bump-version.ts major    # bump major (0.1.0 → 1.0.0)
 *   npx tsx scripts/bump-version.ts 1.2.3    # set versão específica
 *
 * O versionCode Android é gerado automaticamente:
 * - major * 10000 + minor * 100 + patch
 * Exemplo: 1.2.3 → versionCode = 10203
 *
 * Requer JAVA_HOME ou java no PATH para parse do build.gradle.
 * Funciona sem keystore (build de debug continua funcionando).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function setPackageVersion(version: string): void {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`package.json: ${pkg.version} → ${version}`);
}

function getAndroidVersion(): { versionName: string; versionCode: number } {
  const buildGradle = readFileSync(join(ROOT, 'android', 'app', 'build.gradle'), 'utf-8');

  const versionNameMatch = buildGradle.match(/versionName\s+"([^"]+)"/);
  const versionCodeMatch = buildGradle.match(/versionCode\s+(\d+)/);

  return {
    versionName: versionNameMatch?.[1] ?? '1.0',
    versionCode: versionCodeMatch ? parseInt(versionCodeMatch[1], 10) : 1,
  };
}

function setAndroidVersion(version: string, dryRun = false): void {
  const buildGradlePath = join(ROOT, 'android', 'app', 'build.gradle');
  let content = readFileSync(buildGradlePath, 'utf-8');

  const [major, minor, patch] = version.split('.').map(Number);
  const versionCode = major * 10000 + (minor || 0) * 100 + (patch || 0);

  // Update versionName
  content = content.replace(
    /versionName\s+"[^"]+"/,
    `versionName "${version}"`
  );

  // Update versionCode
  content = content.replace(
    /versionCode\s+\d+/,
    `versionCode ${versionCode}`
  );

  if (dryRun) {
    const old = getAndroidVersion();
    console.log(`android/app/build.gradle (dry-run): ${old.versionName} → ${version}, versionCode ${old.versionCode} → ${versionCode}`);
    return;
  }

  writeFileSync(buildGradlePath, content);
  console.log(`android/app/build.gradle: versionName → ${version}, versionCode → ${versionCode}`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    const pkgVersion = getPackageVersion();
    const androidVersion = getAndroidVersion();
    console.log(`Versão atual:`);
    console.log(`  package.json:       ${pkgVersion}`);
    console.log(`  Android (build):   ${androidVersion.versionName} (versionCode ${androidVersion.versionCode})`);
    console.log(`\nUso: bump-version.ts [major|minor|patch|<versão>]`);
    return;
  }

  const currentVersion = getPackageVersion();
  const [major, minor, patch] = currentVersion.split('.').map(Number);

  let newVersion: string;

  if (command === 'major') {
    newVersion = `${major + 1}.0.0`;
  } else if (command === 'minor') {
    newVersion = `${major}.${(minor || 0) + 1}.0`;
  } else if (command === 'patch') {
    newVersion = `${major}.${minor || 0}.${(patch || 0) + 1}`;
  } else if (/^\d+\.\d+\.\d+$/.test(command)) {
    newVersion = command;
  } else {
    console.error(`Comando inválido: ${command}`);
    console.error('Use: major, minor, patch, ou x.y.z');
    process.exit(1);
  }

  console.log(`Atualizando: ${currentVersion} → ${newVersion}\n`);

  setPackageVersion(newVersion);
  setAndroidVersion(newVersion);

  console.log('\n✓ Versionamento atualizado com sucesso.');
}

main();
