/* Clipboard images use the same explicit preview-and-send flow as attachments. */
globalThis.composerTools = {
  imageLabel(file) {
    const size = file.size >= 1024 * 1024 ?
      (file.size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB" :
      Math.max(1, Math.ceil(file.size / 1024)) + " KB";
    return (file.name?.trim() || "Pasted image") + " · " + size;
  },
  imageError(file) {
    if (!file || !["image/png","image/jpeg","image/webp","image/gif"].includes(file.type)) {
      return "Choose a PNG, JPEG, WebP, or GIF image.";
    }
    if (!Number.isFinite(file.size) || file.size <= 0) return "This image is empty. Choose another image.";
    if (file.size > 5 * 1024 * 1024) return "Images must be 5 MB or smaller.";
    return "";
  },
  pastedImage(clipboard) {
    for (const item of Array.from(clipboard?.items || [])) {
      if (item.kind !== "file" || !item.type?.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) return file;
    }
    return null;
  },
  handlePaste(event, {blocked, error, select}) {
    const file = this.pastedImage(event.clipboardData);
    if (!file) return false; // Keep normal text/URL pasting.
    event.preventDefault();
    if (blocked) {
      error("Wait until the chat is connected and the current message finishes sending, then paste the image again.");
      return true;
    }
    const problem = this.imageError(file);
    if (problem) error(problem);
    else select(file); // Preview only, never upload or submit.
    return true;
  },
};
