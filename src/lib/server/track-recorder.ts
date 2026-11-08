import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { BurnError } from "./burn-error"

const exec = promisify(execFile)

// drutil treats the dictionary returned for CUE files as a single DRTrack on
// some macOS releases. Unpack the tracks before calling DiscRecording.
const recorder = `
ObjC.import("DiscRecording");

function run(args) {
  if (!$.DRBurn.respondsToSelector("layoutForImageFile:")) {
    return "This macOS version cannot load CUE layouts.";
  }
  var image = $.DRBurn.layoutForImageFile(args[0]);
  if (!image || image.isNil()) return "macOS could not read the CUE layout.";
  var tracks = image.objectForKey("_DRBurnCueLayout");
  if (!tracks || tracks.isNil() || !tracks.count) {
    return "The CUE layout contains no readable tracks.";
  }
  var sectors = 0;
  for (var i = 0; i < tracks.count; i++) {
    var track = tracks.objectAtIndex(i);
    var length = Number(track.estimateLength);
    if (!Number.isSafeInteger(length) || length <= 0) {
      return "The CUE layout contains an invalid track.";
    }
    sectors += length + track.properties.objectForKey($.DRPreGapLengthKey).sectors;
  }

  var devices = $.DRDevice.devices;
  if (devices.count !== 1) return "Connect exactly one CD writer and try again.";
  var device = devices.objectAtIndex(0);
  var media = device.status.objectForKey($.DRDeviceMediaInfoKey);
  if (!device.mediaIsBlank || device.mediaIsBusy || !media || media.isNil() ||
      !media.objectForKey($.DRDeviceMediaClassKey).isEqualToString($.DRDeviceMediaClassCD)) {
    return "Insert a blank, writable CD and check the drive again.";
  }
  if (sectors > device.mediaSpaceFree.sectors) return "The tracks will not fit on the CD.";

  var burn = $.DRBurn.burnForDevice(device);
  var properties = $.NSMutableDictionary.dictionaryWithDictionary(burn.properties);
  var cueProperties = image.objectForKey("_DRBurnCueProperties");
  if (cueProperties && !cueProperties.isNil()) properties.addEntriesFromDictionary(cueProperties);
  properties.setObjectForKey($.NSNumber.numberWithBool(true), $.DRSynchronousBehaviorKey);
  burn.setProperties(properties);
  burn.setAppendable(false);
  burn.setVerifyDisc(true);
  burn.setCompletionAction($.DRBurnCompletionActionEject);
  burn.writeLayout(tracks);
  var state = ObjC.unwrap(burn.status.objectForKey($.DRStatusStateKey));
  if (state !== ObjC.unwrap($.DRStatusStateDone)) {
    console.log(ObjC.unwrap(burn.status.description));
    return "macOS could not burn or verify the CD.";
  }
  return "ok";
}
`

export async function recordCue(path: string) {
  let result: string
  try {
    const { stdout } = await exec("/usr/bin/osascript", [
      "-l",
      "JavaScript",
      "-e",
      recorder,
      path,
    ])
    result = stdout.trim()
  } catch (error) {
    console.error("Burna could not record the CD tracks", error)
    throw new BurnError("macOS could not load or record the CD tracks.", 422)
  }

  if (result !== "ok") {
    throw new BurnError(result || "macOS could not record the CD tracks.", 422)
  }
}
