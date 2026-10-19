/**
 * Profile picture pipeline for the account settings screen.
 *
 * The picture is decoded and downscaled in this browser and stored as a data
 * URL, because the offline data layer has nowhere else to put it. Doing the
 * work here keeps a multi-megabyte camera photo from ever reaching localStorage
 * (the whole data layer shares a ~5 MB quota) and keeps the top bar light.
 */

/** Longest edge of the stored picture. Avatars render at 48px; 2x for retina. */
const MAX_EDGE = 320;
/** Source files above this are refused before any decoding happens. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
/** Prefer PNG (keeps transparency) while the encoded result stays this small. */
const PNG_BUDGET = 180_000;

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    image.src = url;
  });
}

/**
 * Turn an uploaded file into a data URL sized for an avatar.
 * Throws a message meant for the user, not for a log.
 */
export async function processProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file — PNG, JPEG, WebP or SVG.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Pick an image smaller than 8 MB.");
  }

  const image = await decode(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error("That image has no intrinsic size and cannot be displayed.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot process images.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const png = canvas.toDataURL("image/png");
  if (png.length <= PNG_BUDGET) return png;

  // Too heavy as PNG: flatten onto the interface bed and use JPEG instead.
  context.fillStyle = "#0d0b10";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/jpeg", 0.85);
}
