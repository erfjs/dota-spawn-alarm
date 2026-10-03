/**
 * Embed the app icon into the pkg EXE using resedit (safer than rcedit for pkg).
 * Verifies the binary still loads; restores backup on failure.
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

/** @type {typeof import("resedit") | null} */
let ResEdit = null;

async function loadResEdit() {
  if (!ResEdit) {
    ResEdit = await import("resedit");
  }
  return ResEdit;
}

const exe = path.join(__dirname, "..", "dist-bin", "DotaSpawnAlarm.exe");
const backup = `${exe}.preicon`;
const icoCandidates = [
  path.join(__dirname, "..", "public", "icon.ico"),
  path.join(__dirname, "..", "public", "icon-tray.ico"),
];

function pickIco() {
  return icoCandidates.find((p) => fs.existsSync(p)) || null;
}

function smokeOk(target) {
  const result = spawnSync(target, ["--uninstall-dry-run-missing"], {
    windowsHide: true,
    timeout: 6000,
    encoding: "utf8",
  });
  const text = `${result.stdout || ""}\n${result.stderr || ""}\n${result.error || ""}`;
  if (/Pkg:\s*Error reading/i.test(text)) return false;
  if (/Error reading from file/i.test(text)) return false;
  // Timed out usually means the app started and kept running — good.
  if (result.error && /ETIMEDOUT|TIMEOUT/i.test(String(result.error))) return true;
  if (result.signal) return true;
  return result.status !== null;
}

/** IMAGE_SUBSYSTEM_WINDOWS_GUI — no console window when launching the EXE. */
const WINDOWS_GUI = 2;

async function applyWithResedit(icoPath) {
  const RE = await loadResEdit();
  const exeBuf = fs.readFileSync(exe);
  const iconFile = RE.Data.IconFile.from(fs.readFileSync(icoPath));
  const exeFile = RE.NtExecutable.from(exeBuf, { ignoreCert: true });
  // Hide the black terminal that pkg console builds otherwise show.
  exeFile.newHeader.optionalHeader.subsystem = WINDOWS_GUI;
  const res = RE.NtExecutableResource.from(exeFile);
  const groups = RE.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups[0]?.id ?? 1;
  const lang = groups[0]?.lang ?? 1033;
  RE.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    id,
    lang,
    iconFile.icons.map((item) => item.data),
  );

  const versions = RE.Resource.VersionInfo.fromEntries(res.entries);
  if (versions[0]) {
    const vi = versions[0];
    vi.setFileVersion(1, 0, 0, 0, 1033);
    vi.setProductVersion(1, 0, 0, 0, 1033);
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: "Dota Spawn Alarm",
        FileDescription: "Dota Spawn Alarm",
        CompanyName: "Dota Spawn Alarm",
        OriginalFilename: "DotaSpawnAlarm.exe",
        InternalName: "DotaSpawnAlarm",
        ProductVersion: "1.0.0",
        FileVersion: "1.0.0",
      },
    );
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exeFile);
  fs.writeFileSync(exe, Buffer.from(exeFile.generate()));
}

async function applyWithRcedit(icoPath) {
  const { rcedit } = require("rcedit");
  await rcedit(exe, {
    icon: icoPath,
    "version-string": {
      ProductName: "Dota Spawn Alarm",
      FileDescription: "Dota Spawn Alarm",
      CompanyName: "Dota Spawn Alarm",
      OriginalFilename: "DotaSpawnAlarm.exe",
      InternalName: "DotaSpawnAlarm",
    },
    "product-version": "1.0.0",
    "file-version": "1.0.0",
  });
}

async function applyGuiSubsystemOnly() {
  const RE = await loadResEdit();
  const exeBuf = fs.readFileSync(exe);
  const exeFile = RE.NtExecutable.from(exeBuf, { ignoreCert: true });
  exeFile.newHeader.optionalHeader.subsystem = WINDOWS_GUI;
  fs.writeFileSync(exe, Buffer.from(exeFile.generate()));
}

async function main() {
  const ico = pickIco();
  if (!fs.existsSync(exe)) {
    console.error(`EXE not found: ${exe}`);
    process.exit(1);
  }

  fs.copyFileSync(exe, backup);
  const before = fs.statSync(backup).size;

  if (ico) {
    const attempts = [
      ["resedit", async () => applyWithResedit(ico)],
      ["rcedit", async () => applyWithRcedit(ico)],
    ];

    for (const [name, run] of attempts) {
      try {
        fs.copyFileSync(backup, exe);
        await run();
        const after = fs.statSync(exe).size;
        if (after < before * 0.85) {
          throw new Error(`EXE shrank unexpectedly (${before} -> ${after})`);
        }
        if (!smokeOk(exe)) {
          throw new Error("EXE failed smoke check after icon patch");
        }
        fs.unlinkSync(backup);
        console.log(`Icon applied via ${name} (${path.basename(ico)}) -> ${exe}`);
        return;
      } catch (err) {
        console.warn(`${name} failed: ${err.message || err}`);
        fs.copyFileSync(backup, exe);
      }
    }
  } else {
    console.warn("No icon.ico found; applying GUI subsystem only.");
  }

  try {
    await applyGuiSubsystemOnly();
    if (!smokeOk(exe)) {
      throw new Error("EXE failed smoke check after GUI subsystem patch");
    }
    fs.unlinkSync(backup);
    console.log(`GUI subsystem applied (no console window) -> ${exe}`);
  } catch (err) {
    fs.copyFileSync(backup, exe);
    fs.unlinkSync(backup);
    console.warn(`Kept console EXE: ${err.message || err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
