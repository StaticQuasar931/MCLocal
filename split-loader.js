"use strict";

export const SplitLoader = (() => {
  const blobUrlCache = new Map();
  const htmlCache = new Map();

  function validateParts(parts) {
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error("SplitLoader: 'parts' must be a non-empty array.");
    }

    for (const part of parts) {
      if (typeof part !== "string" || !part.trim()) {
        throw new Error("SplitLoader: every part path must be a non-empty string.");
      }
    }
  }

  function validateFrame(frame) {
    if (!(frame instanceof HTMLIFrameElement)) {
      throw new Error("SplitLoader: 'frame' must be an iframe element.");
    }
  }

  async function fetchTextFile(url) {
    const response = await fetch(url, {
      cache: "no-cache"
    });

    if (!response.ok) {
      throw new Error(`SplitLoader: failed to fetch "${url}" (${response.status} ${response.statusText})`);
    }

    return await response.text();
  }

  async function joinParts(parts, onProgress, id) {
    validateParts(parts);

    let combined = "";

    for (let i = 0; i < parts.length; i++) {
      const partUrl = parts[i];
      const text = await fetchTextFile(partUrl);
      combined += text;

      if (typeof onProgress === "function") {
        onProgress({
          id,
          current: i + 1,
          total: parts.length,
          part: partUrl
        });
      }
    }

    return combined;
  }

  async function buildBlobUrl({ id, parts, onProgress }) {
    validateParts(parts);

    const cacheKey = JSON.stringify(parts);

    if (blobUrlCache.has(cacheKey)) {
      return blobUrlCache.get(cacheKey);
    }

    let html;
    if (htmlCache.has(cacheKey)) {
      html = htmlCache.get(cacheKey);
    } else {
      html = await joinParts(parts, onProgress, id);
      htmlCache.set(cacheKey, html);
    }

    if (!html || typeof html !== "string" || html.length < 100) {
      throw new Error(`SplitLoader: combined HTML for "${id}" is empty or too short.`);
    }

    const blob = new Blob([html], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);

    blobUrlCache.set(cacheKey, blobUrl);
    return blobUrl;
  }

  async function loadIntoFrame({
    frame,
    id = "unknown-version",
    parts,
    onProgress = null,
    onBeforeLoad = null,
    onAfterLoad = null
  }) {
    validateFrame(frame);
    validateParts(parts);

    if (typeof onBeforeLoad === "function") {
      onBeforeLoad({ id, parts });
    }

    const blobUrl = await buildBlobUrl({ id, parts, onProgress });

    await new Promise((resolve, reject) => {
      const handleLoad = () => {
        frame.removeEventListener("load", handleLoad);
        frame.removeEventListener("error", handleError);
        resolve();
      };

      const handleError = () => {
        frame.removeEventListener("load", handleLoad);
        frame.removeEventListener("error", handleError);
        reject(new Error(`SplitLoader: iframe failed to load blob for "${id}".`));
      };

      frame.addEventListener("load", handleLoad, { once: true });
      frame.addEventListener("error", handleError, { once: true });
      frame.src = blobUrl;
    });

    if (typeof onAfterLoad === "function") {
      onAfterLoad({ id, parts, src: frame.src });
    }

    return blobUrl;
  }

  function unloadFrame(frame) {
    validateFrame(frame);
    frame.removeAttribute("src");
    frame.src = "about:blank";
  }

  function clearCache() {
    for (const [, blobUrl] of blobUrlCache) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (_) {}
    }

    blobUrlCache.clear();
    htmlCache.clear();
  }

  function getVersionConfig(id, versionMap) {
    if (!versionMap || typeof versionMap !== "object") {
      throw new Error("SplitLoader: versionMap must be an object.");
    }

    const config = versionMap[id];

    if (!config) {
      throw new Error(`SplitLoader: no version config found for "${id}".`);
    }

    if (!Array.isArray(config.parts) || config.parts.length === 0) {
      throw new Error(`SplitLoader: version "${id}" is missing a valid 'parts' array.`);
    }

    return config;
  }

  return {
    loadIntoFrame,
    unloadFrame,
    clearCache,
    getVersionConfig
  };
})();
